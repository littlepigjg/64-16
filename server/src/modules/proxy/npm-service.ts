import { Response } from 'express';
import { config } from '../../config';
import { getMetadataIndex } from '../metadata';
import { getCacheStorage } from '../cache';
import { parseNpmPackageName, sanitizePath } from '../../utils';
import { isPrivateScope } from '../private-pkg';
import { tryUpstreamRequest } from './utils';
import type { PackageVersion } from '../../types';

export interface LocalNpmMetadataResult {
  found: boolean;
  metadata?: any;
}

export function getLocalNpmMetadata(packageName: string): LocalNpmMetadataResult {
  const metadata = getMetadataIndex();
  const { scope } = parseNpmPackageName(packageName);

  if (scope && isPrivateScope(scope)) {
    return { found: false };
  }

  const pkg = metadata.getPackage(packageName, 'npm');
  if (!pkg || !pkg.versions || pkg.versions.length === 0) {
    return { found: false };
  }

  const versions: Record<string, any> = {};
  for (const v of pkg.versions as PackageVersion[]) {
    const filename = v.filePath.split('\\').pop()?.split('/').pop() || `${sanitizePath(packageName)}-${v.version}.tgz`;
    versions[v.version] = {
      name: packageName,
      version: v.version,
      description: pkg.description,
      dist: {
        shasum: v.sha1 || '',
        tarball: `http://localhost:${config.port}/npm/${encodeURIComponent(packageName)}/-/${filename}`,
        size: v.size,
      },
    };
  }

  const distTags = pkg.latestVersion ? { latest: pkg.latestVersion } : {};

  return {
    found: true,
    metadata: {
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
    },
  };
}

export async function fetchUpstreamNpmMetadata(packageName: string): Promise<{
  ok: boolean;
  response?: { statusCode: number; headers: Record<string, string>; body: Buffer };
  circuitOpen: boolean;
  error?: Error;
}> {
  const result = await tryUpstreamRequest(`${config.npm.upstream}/${encodeURIComponent(packageName)}`);
  return {
    ok: result.ok && !!result.response,
    response: result.response,
    circuitOpen: result.isCircuitBreakerOpen,
    error: result.error,
  };
}

export async function fetchUpstreamNpmVersionMetadata(
  packageName: string,
  version: string
): Promise<{
  ok: boolean;
  response?: { statusCode: number; headers: Record<string, string>; body: Buffer };
  circuitOpen: boolean;
  error?: Error;
}> {
  const result = await tryUpstreamRequest(
    `${config.npm.upstream}/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`
  );
  return {
    ok: result.ok && !!result.response,
    response: result.response,
    circuitOpen: result.isCircuitBreakerOpen,
    error: result.error,
  };
}

export async function fetchUpstreamNpmTarball(
  packageName: string,
  filename: string
): Promise<{
  ok: boolean;
  response?: { statusCode: number; headers: Record<string, string>; body: Buffer };
  circuitOpen: boolean;
  error?: Error;
}> {
  const upstreamUrl = `${config.npm.upstream}/${encodeURIComponent(packageName)}/-/${filename}`;
  const result = await tryUpstreamRequest(upstreamUrl);
  return {
    ok: result.ok && !!result.response,
    response: result.response,
    circuitOpen: result.isCircuitBreakerOpen,
    error: result.error,
  };
}

export function sendNpmMetadata(res: Response, metadata: any): void {
  res.json(metadata);
}

export function sendNpmVersionMetadata(
  res: Response,
  response: { statusCode: number; headers: Record<string, string>; body: Buffer }
): void {
  res.status(response.statusCode);
  res.setHeader('Content-Type', response.headers['content-type'] || 'application/json');
  res.send(response.body);
}

export function sendNpmUnavailableError(res: Response, packageName: string, upstreamName: string = 'npm'): void {
  res.setHeader('Retry-After', '30');
  res.setHeader('X-Upstream-Status', 'unavailable');
  res.status(503).json({
    error: 'Upstream Unavailable',
    message: `Cannot fetch metadata for '${packageName}' because the ${upstreamName} upstream is temporarily unavailable. Please try again later.`,
    upstream: upstreamName,
    retryAfter: 30,
  });
}

export function cacheNpmMetadata(packageName: string, responseBody: Buffer): void {
  const metadata = getMetadataIndex();
  const cache = getCacheStorage();
  const { scope } = parseNpmPackageName(packageName);

  try {
    const pkgData = JSON.parse(responseBody.toString());
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
  } catch {
    // Ignore parsing errors
  }
}


