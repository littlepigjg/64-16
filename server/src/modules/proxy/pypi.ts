import { Router, Request, Response, NextFunction } from 'express';
import { config } from '../../config';
import { getCacheStorage } from '../cache';
import { PypiFileLink, PypiPackageLink, tryUpstreamRequest, makeRequest } from './utils';
import {
  getLocalSimpleIndex,
  fetchUpstreamSimpleIndex,
  mergeSimpleIndex,
  sendSimpleIndex,
  getLocalPackageFiles,
  fetchUpstreamPackageFiles,
  mergePackageFiles,
  sendPackageLinks,
  sendNotFoundHtml,
  sendUpstreamErrorHtml,
  sendUpstreamUnavailableError,
  serveLocalFile,
  serveAndCache,
  findLocalPackage,
} from './pypi-service';

const pypiRouter = Router();

pypiRouter.get('/simple/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const localSet = getLocalSimpleIndex();

    let upstreamPackages: PypiPackageLink[] = [];
    let upstreamFailed = false;

    try {
      const result = await fetchUpstreamSimpleIndex();
      upstreamPackages = result.packages;
      upstreamFailed = result.failed;
    } catch (_err) {
      upstreamFailed = true;
    }

    const merged = mergeSimpleIndex(localSet, upstreamPackages);
    sendSimpleIndex(res, merged, localSet.size, upstreamFailed);
  } catch (err) {
    next(err);
  }
});

pypiRouter.get(/^\/simple\/(.+)\/$/, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const packageName = decodeURIComponent(req.params[0] as string);

    const localResult = getLocalPackageFiles(packageName);

    let upstreamFiles: PypiFileLink[] = [];
    let upstreamFailed = false;
    let upstreamNotFound = false;

    try {
      const result = await fetchUpstreamPackageFiles(packageName);
      upstreamFiles = result.files;
      upstreamFailed = result.failed;
      upstreamNotFound = result.notFound;
    } catch (_err) {
      upstreamFailed = true;
    }

    if (upstreamNotFound && localResult.files.length === 0) {
      sendNotFoundHtml(res, packageName);
      return;
    }

    if (upstreamFailed && localResult.files.length === 0) {
      sendUpstreamErrorHtml(res, packageName);
      return;
    }

    const mergedFiles = mergePackageFiles(localResult.files, upstreamFiles);
    sendPackageLinks(res, localResult.displayName, mergedFiles, localResult.files.length, upstreamFailed);
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
      const cache = getCacheStorage();

      const cachePath = cache.getPypiCachePath(packageName, version, filename);

      if (cache.fileExists(cachePath)) {
        serveLocalFile(res, packageName, version, cachePath);
        return;
      }

      const matchedPkg = findLocalPackage(packageName);
      if (matchedPkg && matchedPkg.name !== packageName) {
        const altCachePath = cache.getPypiCachePath(matchedPkg.name, version, filename);
        if (cache.fileExists(altCachePath)) {
          serveLocalFile(res, matchedPkg.name, version, altCachePath);
          return;
        }
      }

      const normalizedName = (matchedPkg?.name || packageName).replace(/_/g, '-');
      const firstLetter = normalizedName[0]?.toLowerCase() || normalizedName[0];
      const upstreamUrl = `https://files.pythonhosted.org/packages/source/${firstLetter}/${normalizedName}/${filename}`;

      const primaryResult = await tryUpstreamRequest(upstreamUrl, { timeout: 30000 });
      if (primaryResult.ok && primaryResult.response && primaryResult.response.statusCode === 200) {
        serveAndCache(primaryResult.response, matchedPkg?.name || packageName, version, filename, cachePath, res);
        return;
      }

      const altUrl = `${config.pypi.upstream}/packages/source/${firstLetter}/${packageName}/${filename}`;
      const altResult = await tryUpstreamRequest(altUrl, { timeout: 30000 });
      if (altResult.ok && altResult.response && altResult.response.statusCode === 200) {
        serveAndCache(altResult.response, matchedPkg?.name || packageName, version, filename, cachePath, res);
        return;
      }

      if (primaryResult.isCircuitBreakerOpen || altResult.isCircuitBreakerOpen) {
        const upstreamName = primaryResult.upstreamName || altResult.upstreamName || 'pypi';
        const retryAfter = 30;
        sendUpstreamUnavailableError(res, filename, upstreamName, retryAfter);
        return;
      }

      res.status(404).json({ error: 'File not found' });
    } catch (err) {
      next(err);
    }
  }
);

pypiRouter.get('/pypi/:package/json', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const packageName = req.params.package as string;
    const result = await tryUpstreamRequest(
      `${config.pypi.upstream}/pypi/${encodeURIComponent(packageName)}/json`,
      { timeout: 15000 }
    );

    if (!result.ok || !result.response) {
      if (result.isCircuitBreakerOpen) {
        const upstreamName = result.upstreamName || 'pypi';
        sendUpstreamUnavailableError(res, packageName, upstreamName, 30);
        return;
      }
      res.status(502).json({ error: 'Upstream request failed' });
      return;
    }

    res.status(result.response.statusCode);
    res.setHeader('Content-Type', result.response.headers['content-type'] || 'application/json');
    res.send(result.response.body);
  } catch (err) {
    next(err);
  }
});

export { pypiRouter };
export type { PypiFileLink };
