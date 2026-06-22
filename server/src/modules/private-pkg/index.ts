import { Router, Request, Response } from 'express';
import { config } from '../../config';
import { getMetadataIndex } from '../metadata';
import { getCacheStorage } from '../cache';
import { parseNpmPackageName } from '../../utils';
import type { RegistryType, PackageSource, PackageVersion } from '../../types';
import semver from 'semver';

const router = Router();

export function isPrivateScope(scope: string): boolean {
  return config.npm.privateScopes.some(s =>
    scope.toLowerCase() === s.toLowerCase() ||
    scope.toLowerCase().startsWith(s.toLowerCase().replace('*', ''))
  );
}

router.get('/scopes', (_req: Request, res: Response) => {
  res.json({
    scopes: config.npm.privateScopes,
  });
});

router.get('/packages', (req: Request, res: Response) => {
  const metadata = getMetadataIndex();
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const limit = parseInt(typeof req.query.limit === 'string' ? req.query.limit : '50', 10);
  const offset = parseInt(typeof req.query.offset === 'string' ? req.query.offset : '0', 10);
  const registry = (typeof req.query.registry === 'string' ? req.query.registry as RegistryType : undefined);
  const source = (typeof req.query.source === 'string' ? req.query.source as PackageSource : undefined);
  const sortBy = typeof req.query.sortBy === 'string'
    ? (req.query.sortBy as 'name' | 'updatedAt' | 'size' | 'downloads')
    : 'updatedAt';
  const sortOrder = typeof req.query.sortOrder === 'string'
    ? (req.query.sortOrder as 'asc' | 'desc')
    : 'desc';

  const result = metadata.listPackages({ registry, source, search, limit, offset, sortBy, sortOrder });
  res.json(result);
});

router.get('/packages/:registry/:name', (req: Request, res: Response) => {
  const metadata = getMetadataIndex();
  const registry = req.params.registry as string as RegistryType;
  const name = decodeURIComponent(req.params.name as string);

  const pkg = metadata.getPackage(name, registry);
  if (!pkg) {
    res.status(404).json({ error: 'Package not found' });
    return;
  }
  res.json(pkg);
});

router.delete('/packages/:registry/:name', (req: Request, res: Response) => {
  const metadata = getMetadataIndex();
  const cache = getCacheStorage();
  const registry = req.params.registry as string as RegistryType;
  const name = decodeURIComponent(req.params.name as string);

  const pkg = metadata.getPackage(name, registry);
  if (!pkg) {
    res.status(404).json({ error: 'Package not found' });
    return;
  }

  cache.deletePackageFiles(name, registry);
  metadata.deletePackage(name, registry);

  res.json({ success: true, deleted: name });
});

router.delete('/packages/:registry/:name/versions/:version', (req: Request, res: Response) => {
  const metadata = getMetadataIndex();
  const cache = getCacheStorage();
  const registry = req.params.registry as string as RegistryType;
  const name = decodeURIComponent(req.params.name as string);
  const version = req.params.version as string;

  const pkg = metadata.getPackage(name, registry);
  if (!pkg) {
    res.status(404).json({ error: 'Package not found' });
    return;
  }

  const ver = pkg.versions.find((v: PackageVersion) => v.version === version);
  if (!ver) {
    res.status(404).json({ error: 'Version not found' });
    return;
  }

  cache.deleteVersionFiles(name, registry, version);
  metadata.deletePackageVersion(name, registry, version);

  res.json({ success: true, deleted: `${name}@${version}` });
});

router.post('/packages/:registry/:name/cleanup-unused', (req: Request, res: Response) => {
  const metadata = getMetadataIndex();
  const cache = getCacheStorage();
  const registry = req.params.registry as string as RegistryType;
  const name = decodeURIComponent(req.params.name as string);
  const keepVersions = parseInt(typeof req.query.keep === 'string' ? req.query.keep : '3', 10);

  const pkg = metadata.getPackage(name, registry);
  if (!pkg) {
    res.status(404).json({ error: 'Package not found' });
    return;
  }

  const sorted = [...pkg.versions as PackageVersion[]].sort((a: PackageVersion, b: PackageVersion) => {
    const va = semver.valid(a.version) ? a.version : '0.0.0';
    const vb = semver.valid(b.version) ? b.version : '0.0.0';
    return semver.rcompare(va, vb);
  });

  const toDelete = sorted.slice(keepVersions);
  const deleted: string[] = [];

  for (const ver of toDelete) {
    cache.deleteVersionFiles(name, registry, ver.version);
    metadata.deletePackageVersion(name, registry, ver.version);
    deleted.push(ver.version);
  }

  res.json({ success: true, kept: keepVersions, deleted });
});

router.get('/stats', (_req: Request, res: Response) => {
  const metadata = getMetadataIndex();
  res.json(metadata.getStats());
});

router.get('/stats/trend', (req: Request, res: Response) => {
  const metadata = getMetadataIndex();
  const days = parseInt(typeof req.query.days === 'string' ? req.query.days : '30', 10);
  res.json(metadata.getStorageTrend(Math.min(days, 365)));
});

router.get('/cache/policy', (_req: Request, res: Response) => {
  const metadata = getMetadataIndex();
  res.json(metadata.getCachePolicy());
});

router.put('/cache/policy', (req: Request, res: Response) => {
  const metadata = getMetadataIndex();
  const body = req.body || {};

  const policy = {
    maxSizeGB: typeof body.maxSizeGB === 'number' ? Math.max(0.1, body.maxSizeGB) : 50,
    maxAgeDays: typeof body.maxAgeDays === 'number' ? Math.max(0, body.maxAgeDays) : 90,
    autoClean: typeof body.autoClean === 'boolean' ? body.autoClean : true,
  };

  metadata.updateCachePolicy(policy);
  res.json({ success: true, policy });
});

router.post('/cache/cleanup', (_req: Request, res: Response) => {
  const metadata = getMetadataIndex();
  const cache = getCacheStorage();
  const result = cache.runCacheCleanup();
  metadata.recordStorageSnapshot();
  res.json({ success: true, ...result });
});

router.post('/cache/snapshot', (_req: Request, res: Response) => {
  const metadata = getMetadataIndex();
  metadata.recordStorageSnapshot();
  res.json({ success: true, timestamp: Date.now() });
});

export { router as privatePkgRouter };
