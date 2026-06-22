import path from 'path';
import type { CircuitBreakerConfig } from './modules/circuit-breaker';

export const config = {
  port: parseInt(process.env.PORT || '4873', 10),
  storageDir: process.env.STORAGE_DIR || path.resolve(process.cwd(), '..', 'storage'),
  dataDir: process.env.DATA_DIR || path.resolve(process.cwd(), '..', 'data'),
  npm: {
    upstream: process.env.NPM_UPSTREAM || 'https://registry.npmjs.org',
    privateScopes: (process.env.NPM_PRIVATE_SCOPES || '@local,@private').split(','),
  },
  pypi: {
    upstream: process.env.PYPI_UPSTREAM || 'https://pypi.org',
    simpleUpstream: process.env.PYPI_SIMPLE_UPSTREAM || 'https://pypi.org/simple',
  },
  cache: {
    maxSizeGB: parseFloat(process.env.CACHE_MAX_SIZE_GB || '50'),
    maxAgeDays: parseInt(process.env.CACHE_MAX_AGE_DAYS || '90', 10),
    autoClean: process.env.CACHE_AUTO_CLEAN !== 'false',
  },
  auth: {
    requireAuth: process.env.REQUIRE_AUTH === 'true',
    adminToken: process.env.ADMIN_TOKEN || 'admin-token-change-me',
  },
  circuitBreaker: {
    failureThreshold: parseInt(process.env.CB_FAILURE_THRESHOLD || '5', 10),
    responseTimeThreshold: parseInt(process.env.CB_RESPONSE_TIME_THRESHOLD || '5000', 10),
    slowResponseThreshold: parseInt(process.env.CB_SLOW_RESPONSE_THRESHOLD || '2000', 10),
    openStateDuration: parseInt(process.env.CB_OPEN_DURATION || '30000', 10),
    halfOpenMaxRequests: parseInt(process.env.CB_HALF_OPEN_MAX || '3', 10),
    rateLimitPerSecond: parseInt(process.env.CB_RATE_LIMIT || '100', 10),
    windowSize: parseInt(process.env.CB_WINDOW_SIZE || '60000', 10),
  } as CircuitBreakerConfig,
};

export type AppConfig = typeof config;
