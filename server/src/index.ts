import express from 'express';
import cors from 'cors';
import path from 'path';
import { config } from './config';
import { npmRouter, pypiRouter, UpstreamUnavailableError } from './modules/proxy';
import { privatePkgRouter } from './modules/private-pkg';
import { getMetadataIndex } from './modules/metadata';
import { getCacheStorage } from './modules/cache';
import { getCircuitBreaker, getAllCircuitBreakers } from './modules/circuit-breaker';
import { ensureDir } from './utils';
import type { UpstreamHealth } from './types';

const app = express();

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.use('/api', privatePkgRouter);
app.use('/npm', npmRouter);
app.use('/pypi', pypiRouter);

const clientDistDir = path.resolve(process.cwd(), '..', 'client', 'dist');
app.use(express.static(clientDistDir));

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    version: '1.0.0',
    config: {
      storageDir: config.storageDir,
      port: config.port,
      npmUpstream: config.npm.upstream,
      pypiUpstream: config.pypi.upstream,
      privateScopes: config.npm.privateScopes,
    },
  });
});

app.get('/api/upstream-health', (_req, res) => {
  const allBreakers = getAllCircuitBreakers();
  const health: UpstreamHealth[] = allBreakers.map(cb => cb.getHealth());
  res.json({ upstreams: health });
});

app.post('/api/upstream-health/:name/reset', (req, res) => {
  const name = req.params.name as string;
  const cb = getAllCircuitBreakers().find(b => b.getName() === name);
  if (cb) {
    cb.forceClose();
    res.json({ success: true, name, state: cb.getState() });
  } else {
    res.status(404).json({ error: 'Upstream not found' });
  }
});

getCircuitBreaker('npm', config.npm.upstream, config.circuitBreaker);
getCircuitBreaker('pypi', config.pypi.upstream, config.circuitBreaker);
getCircuitBreaker('pypi-files', 'https://files.pythonhosted.org', config.circuitBreaker);

app.get('*', (_req, res) => {
  const indexPath = path.join(clientDistDir, 'index.html');
  const fallbackPath = path.join(__dirname, 'public', 'fallback.html');
  res.sendFile(indexPath, (_err) => {
    res.sendFile(fallbackPath);
  });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Server error:', err);

  if (err instanceof UpstreamUnavailableError) {
    res.setHeader('X-Upstream-Status', 'unavailable');
    if (err.retryAfter) {
      res.setHeader('Retry-After', err.retryAfter.toString());
    }
    res.status(503).json({
      error: 'Upstream Unavailable',
      code: err.code,
      message: err.message,
      upstream: {
        name: err.upstreamName,
        url: err.upstreamUrl,
        retryAfter: err.retryAfter,
      },
    });
    return;
  }

  if (err.message && (err.message.includes('timeout') || err.message.includes('timed out'))) {
    res.status(504).json({
      error: 'Gateway Timeout',
      message: 'Upstream request timed out. Please try again later.',
    });
    return;
  }

  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message,
  });
});

ensureDir(config.storageDir);
ensureDir(config.dataDir);

const metadata = getMetadataIndex();
const cache = getCacheStorage();

setInterval(() => {
  try {
    cache.cleanupTemp();
    metadata.recordStorageSnapshot();
  } catch (e) {
    console.error('Periodic task error:', e);
  }
}, 60 * 60 * 1000);

setTimeout(() => {
  try {
    metadata.recordStorageSnapshot();
  } catch (e) {
    console.error('Initial snapshot error:', e);
  }
}, 5000);

app.listen(config.port, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║     Local Registry Proxy v1.0.0                          ║
╠══════════════════════════════════════════════════════════╣
║                                                          ║
║  📊 Web UI:       http://localhost:${config.port}                     ║
║                                                          ║
║  📦 NPM Registry: http://localhost:${config.port}/npm                  ║
║     npm config set registry http://localhost:${config.port}/npm       ║
║                                                          ║
║  🐍 PyPI Index:   http://localhost:${config.port}/pypi/simple/         ║
║     pip install -i http://localhost:${config.port}/pypi/simple/ ...    ║
║                                                          ║
║  🔒 Private Scopes: ${config.npm.privateScopes.join(', ').padEnd(30)} ║
║                                                          ║
║  💾 Storage:      ${config.storageDir.padEnd(42)}║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
  `);
});

process.on('SIGTERM', () => {
  metadata.close();
  getAllCircuitBreakers().forEach(cb => cb.destroy());
  process.exit(0);
});

process.on('SIGINT', () => {
  metadata.close();
  getAllCircuitBreakers().forEach(cb => cb.destroy());
  process.exit(0);
});
