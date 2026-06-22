import { Router, Request, Response, NextFunction } from 'express';
import { config } from '../../config';
import { getMetadataIndex } from '../metadata';
import { getCacheStorage } from '../cache';
import type { PackageVersion } from '../../types';
import {
  makeRequest,
  parsePypiSimpleIndex,
  renderPypiSimpleIndex,
  parsePypiPackageLinks,
  renderPypiPackageLinks,
  normalizePypiName,
  pypiNamesMatch,
  PypiFileLink,
} from './utils';

const pypiRouter = Router();

pypiRouter.get('/simple/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const metadata = getMetadataIndex();
    const { packages: localPackages } = metadata.listPackages({
      registry: 'pypi',
      limit: 100000,
    });

    const localSet = new Map<string, { name: string; private: boolean }>();
    for (const p of localPackages) {
      const norm = normalizePypiName(p.name);
      if (!localSet.has(norm)) {
        localSet.set(norm, { name: p.name, private: p.source === 'private' });
      }
    }

    let upstreamPackages: ReturnType<typeof parsePypiSimpleIndex> = [];
    let upstreamFailed = false;

    try {
      const response = await makeRequest(`${config.pypi.simpleUpstream}/`, { timeout: 2000 });
      if (response.statusCode === 200) {
        upstreamPackages = parsePypiSimpleIndex(response.body.toString('utf-8'));
      } else {
        upstreamFailed = true;
      }
    } catch (_err) {
      upstreamFailed = true;
    }

    const merged = new Map<string, { name: string; href?: string; private?: boolean }>();

    for (const up of upstreamPackages) {
      const norm = normalizePypiName(up.name);
      if (!merged.has(norm)) {
        merged.set(norm, { name: up.name, href: up.href });
      }
    }

    for (const [norm, info] of localSet) {
      merged.set(norm, {
        name: info.name,
        href: `./${encodeURIComponent(info.name)}/`,
        private: info.private,
      });
    }

    const html = renderPypiSimpleIndex(Array.from(merged.values()));

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Local-Packages', localSet.size.toString());
    if (upstreamFailed) {
      res.setHeader('X-Upstream-Status', 'offline');
    }
    res.send(html);
  } catch (err) {
    next(err);
  }
});

pypiRouter.get(/^\/simple\/(.+)\/$/, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const packageName = decodeURIComponent(req.params[0] as string);
    const metadata = getMetadataIndex();
    const cache = getCacheStorage();

    const allLocal = metadata.listPackages({ registry: 'pypi', limit: 100000 }).packages;
    const localPkg = allLocal.find((p) => pypiNamesMatch(p.name, packageName));

    const localFiles: PypiFileLink[] = [];
    if (localPkg && localPkg.versions.length > 0) {
      for (const v of localPkg.versions as PackageVersion[]) {
        const filename =
          v.filePath.split('\\').pop()?.split('/').pop() ||
          `${localPkg.name}-${v.version}.tar.gz`;
        localFiles.push({
          filename,
          href: `/pypi/files/${encodeURIComponent(localPkg.name)}/${encodeURIComponent(v.version)}/${encodeURIComponent(filename)}${
            v.sha1 ? `#sha256=${v.sha1}` : ''
          }`,
          hash: v.sha1,
          size: v.size,
        });
      }
    }

    let upstreamFiles: PypiFileLink[] = [];
    let upstreamFailed = false;

    try {
      const response = await makeRequest(
        `${config.pypi.simpleUpstream}/${encodeURIComponent(packageName)}/`,
        { timeout: 3000 }
      );
      if (response.statusCode === 200) {
        upstreamFiles = parsePypiPackageLinks(response.body.toString('utf-8'));
      } else if (response.statusCode === 404 && localFiles.length === 0) {
        res.status(404).send(
          `<!DOCTYPE html><html><body><h1>Package not found</h1><p>No package named '${packageName}' in local cache or upstream.</p></body></html>`
        );
        return;
      } else {
        upstreamFailed = true;
      }
    } catch (_err) {
      upstreamFailed = true;
      if (localFiles.length === 0) {
        res.status(502).send(
          `<!DOCTYPE html><html><body><h1>Upstream error</h1><p>Cannot reach PyPI upstream and no local cache for '${packageName}'.</p></body></html>`
        );
        return;
      }
    }

    const seenFilenames = new Set<string>();
    const mergedFiles: PypiFileLink[] = [];

    for (const f of localFiles) {
      const norm = f.filename.toLowerCase();
      if (!seenFilenames.has(norm)) {
        seenFilenames.add(norm);
        mergedFiles.push(f);
      }
    }

    for (const f of upstreamFiles) {
      const norm = f.filename.toLowerCase();
      if (!seenFilenames.has(norm)) {
        seenFilenames.add(norm);
        mergedFiles.push(f);
      }
    }

    mergedFiles.sort((a, b) => a.filename.localeCompare(b.filename));

    const displayName = localPkg?.name || packageName;
    const html = renderPypiPackageLinks(displayName, mergedFiles);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Local-Files', localFiles.length.toString());
    if (upstreamFailed) {
      res.setHeader('X-Upstream-Status', 'offline');
    }
    res.send(html);
  } catch (err) {
    next(err);
  }
});

pypiRouter.get(/^\/simple\/(.+)$/, (req: Request, res: Response) => {
  const packageName = req.params[0] as string;
  res.redirect(`/pypi/simple/${packageName}/`);
});

pypiRouter.get(
  '/files/:package/:version/:filename',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const packageName = req.params.package as string;
      const version = req.params.version as string;
      const filename = req.params.filename as string;
      const metadata = getMetadataIndex();
      const cache = getCacheStorage();

      const cachePath = cache.getPypiCachePath(packageName, version, filename);

      if (cache.fileExists(cachePath)) {
        serveLocalFile(res, metadata, cache, packageName, version, cachePath);
        return;
      }

      const allLocal = metadata.listPackages({ registry: 'pypi', limit: 100000 }).packages;
      const matchedPkg = allLocal.find((p) => pypiNamesMatch(p.name, packageName));
      if (matchedPkg && matchedPkg.name !== packageName) {
        const altCachePath = cache.getPypiCachePath(matchedPkg.name, version, filename);
        if (cache.fileExists(altCachePath)) {
          serveLocalFile(res, metadata, cache, matchedPkg.name, version, altCachePath);
          return;
        }
      }

      const normalizedName = (matchedPkg?.name || packageName).replace(/_/g, '-');
      const firstLetter = normalizedName[0]?.toLowerCase() || normalizedName[0];
      const upstreamUrl = `https://files.pythonhosted.org/packages/source/${firstLetter}/${normalizedName}/${filename}`;

      const response = await makeRequest(upstreamUrl, { timeout: 30000 });
      if (response.statusCode !== 200) {
        const altUrl = `${config.pypi.upstream}/packages/source/${firstLetter}/${packageName}/${filename}`;
        const altResponse = await makeRequest(altUrl, { timeout: 30000 });
        if (altResponse.statusCode !== 200) {
          res.status(404).json({ error: 'File not found' });
          return;
        }
        serveAndCache(altResponse, matchedPkg?.name || packageName, version, filename, cachePath, res);
        return;
      }

      serveAndCache(response, matchedPkg?.name || packageName, version, filename, cachePath, res);
    } catch (err) {
      next(err);
    }
  }
);

function serveLocalFile(
  res: Response,
  metadata: ReturnType<typeof getMetadataIndex>,
  cache: ReturnType<typeof getCacheStorage>,
  packageName: string,
  version: string,
  filePath: string
): void {
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

function serveAndCache(
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

pypiRouter.get('/pypi/:package/json', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const packageName = req.params.package as string;
    const response = await makeRequest(`${config.pypi.upstream}/pypi/${encodeURIComponent(packageName)}/json`, {
      timeout: 15000,
    });
    res.status(response.statusCode);
    res.setHeader('Content-Type', response.headers['content-type'] || 'application/json');
    res.send(response.body);
  } catch (err) {
    next(err);
  }
});

export { pypiRouter };
