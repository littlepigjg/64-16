import { Router, Request, Response, NextFunction } from 'express';
import { config } from '../../config';
import { getMetadataIndex } from '../metadata';
import { getCacheStorage } from '../cache';
import { parseNpmPackageName, sanitizePath } from '../../utils';
import { isPrivateScope } from '../private-pkg';
import { makeRequest } from './utils';
import type { PackageVersion } from '../../types';

const npmRouter = Router();

npmRouter.get('/', (_req: Request, res: Response) => {
  res.json({
    db_name: 'local-registry-proxy',
    doc_count: 0,
    doc_del_count: 0,
    update_seq: 0,
    instance_start_time: Date.now().toString(),
  });
});

npmRouter.get('/-/ping', (_req: Request, res: Response) => {
  res.json({});
});

npmRouter.get('/-/v1/search', async (req: Request, res: Response) => {
  try {
    const query = req.url.split('?')[1] || '';
    const response = await makeRequest(`${config.npm.upstream}/-/v1/search?${query}`);
    res.status(response.statusCode);
    res.json(JSON.parse(response.body.toString()));
  } catch (_err) {
    res.status(502).json({ error: 'Upstream request failed' });
  }
});

npmRouter.get('/@:scope/:name/-/:filename', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const packageName = `@${req.params.scope as string}/${req.params.name as string}`;
    const filename = req.params.filename as string;
    await handleNpmTarball(packageName, filename, res);
  } catch (err) {
    next(err);
  }
});

npmRouter.get('/:package/-/:filename', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const packageName = req.params.package as string;
    const filename = req.params.filename as string;
    await handleNpmTarball(packageName, filename, res);
  } catch (err) {
    next(err);
  }
});

npmRouter.get('/@:scope/:name/:version', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const packageName = `@${req.params.scope as string}/${req.params.name as string}`;
    const version = req.params.version as string;
    await handleNpmVersionMetadata(packageName, version, res);
  } catch (err) {
    next(err);
  }
});

npmRouter.get('/:package/:version', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const packageName = req.params.package as string;
    const version = req.params.version as string;
    await handleNpmVersionMetadata(packageName, version, res);
  } catch (err) {
    next(err);
  }
});

npmRouter.get('/@:scope/:name', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const packageName = `@${req.params.scope as string}/${req.params.name as string}`;
    await handleNpmMetadata(packageName, res);
  } catch (err) {
    next(err);
  }
});

npmRouter.get('/:package', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const packageName = req.params.package as string;
    await handleNpmMetadata(packageName, res);
  } catch (err) {
    next(err);
  }
});

npmRouter.put('/@:scope/:name', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const packageName = `@${req.params.scope as string}/${req.params.name as string}`;
    await handleNpmPublish(packageName, req, res);
  } catch (err) {
    next(err);
  }
});

npmRouter.put('/:package', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const packageName = req.params.package as string;
    await handleNpmPublish(packageName, req, res);
  } catch (err) {
    next(err);
  }
});

async function handleNpmMetadata(packageName: string, res: Response): Promise<void> {
  const metadata = getMetadataIndex();
  const cache = getCacheStorage();
  const { scope } = parseNpmPackageName(packageName);

  if (scope && isPrivateScope(scope)) {
    handlePrivateNpmMetadata(packageName, res);
    return;
  }

  const response = await makeRequest(`${config.npm.upstream}/${encodeURIComponent(packageName)}`);

  if (response.statusCode !== 200) {
    res.status(response.statusCode);
    res.send(response.body);
    return;
  }

  const pkgData = JSON.parse(response.body.toString());
  const versionEntries = Object.entries(pkgData.versions || {});

  const pkgId = metadata.getOrCreatePackage(packageName, 'npm', 'cache', scope);
  metadata.upsertPackageInfo({
    name: packageName,
    registry: 'npm',
    description: pkgData.description,
    author: typeof pkgData.author === 'string' ? pkgData.author : pkgData.author?.name,
    license: typeof pkgData.license === 'string' ? pkgData.license : pkgData.license?.type,
    latestVersion: pkgData['dist-tags']?.latest || '',
    source: 'cache',
    scope,
  });

  for (const [version, verData] of versionEntries) {
    const dist = (verData as any).dist || {};
    const tarballUrl: string = dist.tarball || '';
    const filename = tarballUrl.split('/').pop() || `${sanitizePath(packageName)}-${version}.tgz`;
    const cachePath = cache.getNpmCachePath(packageName, version, filename);
    metadata.addVersion(pkgId, version, 0, cachePath, dist.shasum);
  }

  res.json(pkgData);
}

async function handleNpmTarball(packageName: string, filename: string, res: Response): Promise<void> {
  const metadata = getMetadataIndex();
  const cache = getCacheStorage();
  const { scope } = parseNpmPackageName(packageName);

  if (scope && isPrivateScope(scope)) {
    handlePrivateNpmTarball(packageName, filename, res);
    return;
  }

  const versionMatch = filename.match(/-(\d+\.\d+[^-]*)\.tgz$/);
  const version = versionMatch ? versionMatch[1] : '';
  const cachePath = version ? cache.getNpmCachePath(packageName, version, filename) : '';

  if (cachePath && cache.fileExists(cachePath)) {
    const pkg = metadata.getPackage(packageName, 'npm');
    const pkgId = pkg ? metadata.getOrCreatePackage(packageName, 'npm', 'cache') : 0;
    if (pkg && version) {
      metadata.incrementVersionDownload(pkgId, version);
    }
    const fileSize = cache.getFileSize(cachePath);
    res.setHeader('Content-Length', fileSize.toString());
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Cache', 'HIT');
    cache.readStream(cachePath).pipe(res);
    return;
  }

  const upstreamUrl = `${config.npm.upstream}/${encodeURIComponent(packageName)}/-/${filename}`;
  const response = await makeRequest(upstreamUrl);

  if (response.statusCode !== 200) {
    res.status(response.statusCode);
    res.send(response.body);
    return;
  }

  if (cachePath && version) {
    cache.writeFile(cachePath, response.body);
    const pkgId = metadata.getOrCreatePackage(packageName, 'npm', 'cache', scope);
    metadata.addVersion(pkgId, version, response.body.length, cachePath);
    metadata.incrementVersionDownload(pkgId, version);
  }

  res.setHeader('Content-Length', response.body.length.toString());
  res.setHeader('Content-Type', response.headers['content-type'] || 'application/octet-stream');
  res.setHeader('X-Cache', 'MISS');
  res.send(response.body);
}

async function handleNpmVersionMetadata(packageName: string, version: string, res: Response): Promise<void> {
  const { scope } = parseNpmPackageName(packageName);

  if (scope && isPrivateScope(scope)) {
    handlePrivateNpmVersionMetadata(packageName, version, res);
    return;
  }

  const response = await makeRequest(`${config.npm.upstream}/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`);
  res.status(response.statusCode);
  res.setHeader('Content-Type', response.headers['content-type'] || 'application/json');
  res.send(response.body);
}

async function handleNpmPublish(packageName: string, req: Request, res: Response): Promise<void> {
  const { scope } = parseNpmPackageName(packageName);

  if (!scope || !isPrivateScope(scope)) {
    res.status(403).json({
      error: 'Only private scopes can be published. Allowed scopes: ' + config.npm.privateScopes.join(', '),
    });
    return;
  }

  handlePublishNpmPackage(packageName, req, res);
}

function handlePrivateNpmMetadata(packageName: string, res: Response): void {
  const metadata = getMetadataIndex();
  const pkg = metadata.getPackage(packageName, 'npm');

  if (!pkg || pkg.source !== 'private') {
    res.status(404).json({ error: 'Package not found' });
    return;
  }

  const versions: Record<string, any> = {};
  for (const v of pkg.versions as PackageVersion[]) {
    const tarballFilename = v.filePath.split('\\').pop()?.split('/').pop() || `${sanitizePath(packageName)}-${v.version}.tgz`;
    versions[v.version] = {
      name: packageName,
      version: v.version,
      description: pkg.description,
      dist: {
        shasum: v.sha1 || '',
        tarball: `http://localhost:${config.port}/npm/${encodeURIComponent(packageName)}/-/${tarballFilename}`,
        size: v.size,
      },
    };
  }

  const distTags = pkg.latestVersion ? { latest: pkg.latestVersion } : {};

  res.json({
    _id: packageName,
    name: packageName,
    description: pkg.description || '',
    'dist-tags': distTags,
    versions,
    time: {
      created: new Date(pkg.createdAt).toISOString(),
      modified: new Date(pkg.updatedAt).toISOString(),
      ...Object.fromEntries(pkg.versions.map((v: PackageVersion) => [v.version, new Date(v.publishedAt).toISOString()])),
    },
    license: pkg.license || 'UNLICENSED',
  });
}

function handlePrivateNpmVersionMetadata(packageName: string, version: string, res: Response): void {
  const metadata = getMetadataIndex();
  const pkg = metadata.getPackage(packageName, 'npm');

  if (!pkg || pkg.source !== 'private') {
    res.status(404).json({ error: 'Package not found' });
    return;
  }

  const ver = pkg.versions.find((v: PackageVersion) => v.version === version);
  if (!ver) {
    res.status(404).json({ error: 'Version not found' });
    return;
  }

  const tarballFilename = ver.filePath.split('\\').pop()?.split('/').pop() || `${sanitizePath(packageName)}-${version}.tgz`;
  res.json({
    name: packageName,
    version: ver.version,
    description: pkg.description,
    dist: {
      shasum: ver.sha1 || '',
      tarball: `http://localhost:${config.port}/npm/${encodeURIComponent(packageName)}/-/${tarballFilename}`,
      size: ver.size,
    },
  });
}

function handlePrivateNpmTarball(packageName: string, filename: string, res: Response): void {
  const metadata = getMetadataIndex();
  const cache = getCacheStorage();

  const versionMatch = filename.match(/-(\d+\.\d+[^-]*)\.tgz$/);
  const version = versionMatch ? versionMatch[1] : '';

  const filePath = metadata.getVersionFilePath(packageName, 'npm', version);
  if (!filePath || !cache.fileExists(filePath)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  const pkg = metadata.getPackage(packageName, 'npm');
  const pkgId = pkg ? metadata.getOrCreatePackage(packageName, 'npm', 'private', pkg.scope) : 0;
  if (pkg && version) {
    metadata.incrementVersionDownload(pkgId, version);
  }

  const fileSize = cache.getFileSize(filePath);
  res.setHeader('Content-Length', fileSize.toString());
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('X-Cache', 'HIT');
  cache.readStream(filePath).pipe(res);
}

async function handlePublishNpmPackage(packageName: string, req: Request, res: Response): Promise<void> {
  const metadata = getMetadataIndex();
  const cache = getCacheStorage();
  const { scope, name: rawName } = parseNpmPackageName(packageName);

  if (!scope) {
    res.status(400).json({ error: 'Private package must have a scope' });
    return;
  }

  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', resolve);
    req.on('error', reject);
  });

  let body: any;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }

  const version = body['dist-tags']?.latest || Object.keys(body.versions || {})[0];
  const versionData = body.versions?.[version];
  const attachment = body._attachments?.[Object.keys(body._attachments || {})[0]];

  if (!version || !versionData || !attachment) {
    res.status(400).json({ error: 'Missing version or attachment data' });
    return;
  }

  const filename = Object.keys(body._attachments)[0];
  const tarballBuffer = Buffer.from(attachment.data, 'base64');
  const sha1 = attachment.digest?.replace('sha1-', '') || versionData.dist?.shasum || '';

  const filePath = cache.getNpmPrivatePath(scope, rawName, version, filename);
  cache.writeFile(filePath, tarballBuffer);

  const pkgId = metadata.getOrCreatePackage(packageName, 'npm', 'private', scope);
  metadata.upsertPackageInfo({
    name: packageName,
    registry: 'npm',
    description: body.description,
    author: typeof body.author === 'string' ? body.author : body.author?.name,
    license: typeof body.license === 'string' ? body.license : body.license?.type,
    latestVersion: version,
    source: 'private',
    scope,
  });
  metadata.addVersion(pkgId, version, tarballBuffer.length, filePath, sha1);

  res.json({
    ok: true,
    id: packageName,
    rev: Date.now().toString(),
  });
}

export { npmRouter };
