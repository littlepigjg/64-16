import { Response } from 'express';
import { config } from '../../config';
import { getMetadataIndex } from '../metadata';
import { getCacheStorage } from '../cache';
import type { PackageVersion, PackageInfo } from '../../types';
import {
  tryUpstreamRequest,
  parsePypiSimpleIndex,
  renderPypiSimpleIndex,
  parsePypiPackageLinks,
  renderPypiPackageLinks,
  normalizePypiName,
  pypiNamesMatch,
  PypiFileLink,
  PypiPackageLink,
} from './utils';

export interface LocalPackageInfo {
  name: string;
  private: boolean;
}

export function getLocalSimpleIndex(): Map<string, LocalPackageInfo> {
  const metadata = getMetadataIndex();
  const { packages: localPackages } = metadata.listPackages({
    registry: 'pypi',
    limit: 100000,
  });

  const localSet = new Map<string, LocalPackageInfo>();
  for (const p of localPackages) {
    const norm = normalizePypiName(p.name);
    if (!localSet.has(norm)) {
      localSet.set(norm, { name: p.name, private: p.source === 'private' });
    }
  }
  return localSet;
}

export async function fetchUpstreamSimpleIndex(): Promise<{
  packages: PypiPackageLink[];
  failed: boolean;
  circuitOpen: boolean;
}> {
  const result = await tryUpstreamRequest(`${config.pypi.simpleUpstream}/`, { timeout: 2000 });
  if (!result.ok || !result.response) {
    return { packages: [], failed: true, circuitOpen: result.isCircuitBreakerOpen };
  }
  if (result.response.statusCode !== 200) {
    return { packages: [], failed: true, circuitOpen: false };
  }
  try {
    const packages = parsePypiSimpleIndex(result.response.body.toString('utf-8'));
    return { packages, failed: false, circuitOpen: false };
  } catch {
    return { packages: [], failed: true, circuitOpen: false };
  }
}

export function mergeSimpleIndex(
  local: Map<string, LocalPackageInfo>,
  upstream: PypiPackageLink[]
): Array<{ name: string; href?: string; private?: boolean }> {
  const merged = new Map<string, { name: string; href?: string; private?: boolean }>();

  for (const up of upstream) {
    const norm = normalizePypiName(up.name);
    if (!merged.has(norm)) {
      merged.set(norm, { name: up.name, href: up.href });
    }
  }

  for (const [norm, info] of local) {
    merged.set(norm, {
      name: info.name,
      href: `./${encodeURIComponent(info.name)}/`,
      private: info.private,
    });
  }

  return Array.from(merged.values());
}

export function sendSimpleIndex(
  res: Response,
  packages: Array<{ name: string; href?: string; private?: boolean }>,
  localCount: number,
  upstreamFailed: boolean
): void {
  const html = renderPypiSimpleIndex(packages);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Local-Packages', localCount.toString());
  if (upstreamFailed) {
    res.setHeader('X-Upstream-Status', 'offline');
  }
  res.send(html);
}

export interface LocalPackageFilesResult {
  found: boolean;
  displayName: string;
  files: PypiFileLink[];
}

export function getLocalPackageFiles(packageName: string): LocalPackageFilesResult {
  const metadata = getMetadataIndex();
  const allLocal = metadata.listPackages({ registry: 'pypi', limit: 100000 }).packages;
  const localPkg = allLocal.find((p) => pypiNamesMatch(p.name, packageName));

  const files: PypiFileLink[] = [];
  if (localPkg && localPkg.versions.length > 0) {
    for (const v of localPkg.versions as PackageVersion[]) {
      const filename =
        v.filePath.split('\\').pop()?.split('/').pop() ||
        `${localPkg.name}-${v.version}.tar.gz`;
      files.push({
        filename,
        href: `/pypi/files/${encodeURIComponent(localPkg.name)}/${encodeURIComponent(v.version)}/${encodeURIComponent(filename)}${
          v.sha1 ? `#sha256=${v.sha1}` : ''
        }`,
        hash: v.sha1,
        size: v.size,
      });
    }
  }

  return {
    found: !!localPkg,
    displayName: localPkg?.name || packageName,
    files,
  };
}

export async function fetchUpstreamPackageFiles(
  packageName: string
): Promise<{
  files: PypiFileLink[];
  failed: boolean;
  circuitOpen: boolean;
  notFound: boolean;
}> {
  const result = await tryUpstreamRequest(
    `${config.pypi.simpleUpstream}/${encodeURIComponent(packageName)}/`,
    { timeout: 3000 }
  );
  if (!result.ok || !result.response) {
    return { files: [], failed: true, circuitOpen: result.isCircuitBreakerOpen, notFound: false };
  }
  if (result.response.statusCode === 404) {
    return { files: [], failed: false, circuitOpen: false, notFound: true };
  }
  if (result.response.statusCode !== 200) {
    return { files: [], failed: true, circuitOpen: false, notFound: false };
  }
  try {
    const files = parsePypiPackageLinks(result.response.body.toString('utf-8'));
    return { files, failed: false, circuitOpen: false, notFound: false };
  } catch {
    return { files: [], failed: true, circuitOpen: false, notFound: false };
  }
}

export function mergePackageFiles(
  localFiles: PypiFileLink[],
  upstreamFiles: PypiFileLink[]
): PypiFileLink[] {
  const seenFilenames = new Set<string>();
  const merged: PypiFileLink[] = [];

  for (const f of localFiles) {
    const norm = f.filename.toLowerCase();
    if (!seenFilenames.has(norm)) {
      seenFilenames.add(norm);
      merged.push(f);
    }
  }

  for (const f of upstreamFiles) {
    const norm = f.filename.toLowerCase();
    if (!seenFilenames.has(norm)) {
      seenFilenames.add(norm);
      merged.push(f);
    }
  }

  merged.sort((a, b) => a.filename.localeCompare(b.filename));
  return merged;
}

export function sendPackageLinks(
  res: Response,
  displayName: string,
  files: PypiFileLink[],
  localFileCount: number,
  upstreamFailed: boolean
): void {
  const html = renderPypiPackageLinks(displayName, files);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Local-Files', localFileCount.toString());
  if (upstreamFailed) {
    res.setHeader('X-Upstream-Status', 'offline');
  }
  res.send(html);
}

export function sendNotFoundHtml(res: Response, packageName: string): void {
  res.status(404).send(
    `<!DOCTYPE html><html><body><h1>Package not found</h1><p>No package named '${packageName}' in local cache or upstream.</p></body></html>`
  );
}

export function sendUpstreamErrorHtml(res: Response, packageName: string): void {
  res.status(502).send(
    `<!DOCTYPE html><html><body><h1>Upstream error</h1><p>Cannot reach PyPI upstream and no local cache for '${packageName}'.</p></body></html>`
  );
}

export function sendUpstreamIndexErrorHtml(res: Response): void {
  res.status(502).send(
    `<!DOCTYPE html>
<html>
  <head>
    <title>Simple index - Upstream Error</title>
  </head>
  <body>
    <h1>Upstream Error</h1>
    <p>Cannot reach PyPI upstream and no local packages cached yet.</p>
    <p>Please try again later.</p>
  </body>
</html>`
  );
}

export function sendUpstreamUnavailableIndexHtml(res: Response, retryAfter: number = 30): void {
  res.setHeader('Retry-After', retryAfter.toString());
  res.setHeader('X-Upstream-Status', 'unavailable');
  res.status(503).send(
    `<!DOCTYPE html>
<html>
  <head>
    <title>Simple index - Service Unavailable</title>
  </head>
  <body>
    <h1>Service Unavailable</h1>
    <p>PyPI upstream is currently unavailable due to repeated failures.</p>
    <p>Circuit breaker is open to protect the system.</p>
    <p>Please try again after ${retryAfter} seconds.</p>
  </body>
</html>`
  );
}

export function serveLocalFile(
  res: Response,
  packageName: string,
  version: string,
  filePath: string
): void {
  const metadata = getMetadataIndex();
  const cache = getCacheStorage();

  const pkg = metadata.getPackage(packageName, 'pypi');
  if (pkg) {
    metadata.incrementVersionDownload(
      metadata.getOrCreatePackage(packageName, 'pypi', pkg.source),
      version
    );
  }
  const fileSize = cache.getFileSize(filePath);
  res.setHeader('Content-Length', fileSize.toString());
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('X-Cache', 'HIT');
  cache.readStream(filePath).pipe(res);
}

export function serveAndCache(
  response: { statusCode: number; headers: Record<string, string>; body: Buffer },
  packageName: string,
  version: string,
  filename: string,
  cachePath: string,
  res: Response
): void {
  const metadata = getMetadataIndex();
  const cache = getCacheStorage();

  cache.writeFile(cachePath, response.body);
  const pkgId = metadata.getOrCreatePackage(packageName, 'pypi', 'cache');
  metadata.addVersion(pkgId, version, response.body.length, cachePath);
  metadata.incrementVersionDownload(pkgId, version);

  res.setHeader('Content-Length', response.body.length.toString());
  res.setHeader('Content-Type', response.headers['content-type'] || 'application/octet-stream');
  res.setHeader('X-Cache', 'MISS');
  res.send(response.body);
}

export function findLocalPackage(packageName: string): PackageInfo | undefined {
  const metadata = getMetadataIndex();
  const allLocal = metadata.listPackages({ registry: 'pypi', limit: 100000 }).packages;
  return allLocal.find((p) => pypiNamesMatch(p.name, packageName));
}

export function sendUpstreamUnavailableError(res: Response, packageName: string, upstreamName: string, retryAfter: number | null = null): void {
  if (retryAfter) {
    res.setHeader('Retry-After', retryAfter.toString());
  }
  res.setHeader('X-Upstream-Status', 'unavailable');
  res.status(503).json({
    error: 'Upstream Unavailable',
    message: `Cannot download '${packageName}' because the ${upstreamName} upstream is temporarily unavailable. Please try again later.`,
    upstream: upstreamName,
    retryAfter,
  });
}
