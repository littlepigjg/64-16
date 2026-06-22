export type RegistryType = 'npm' | 'pypi';

export type PackageSource = 'cache' | 'private' | 'upstream';

export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

export type UpstreamStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface UpstreamHealth {
  name: string;
  url: string;
  state: CircuitBreakerState;
  status: UpstreamStatus;
  totalRequests: number;
  successCount: number;
  failureCount: number;
  slowResponseCount: number;
  consecutiveFailures: number;
  avgResponseTime: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  openUntil: number | null;
  rateLimitRemaining: number;
  errorRate: number;
}

export interface PackageInfo {
  name: string;
  registry: RegistryType;
  source: PackageSource;
  versions: PackageVersion[];
  latestVersion: string;
  description?: string;
  author?: string;
  license?: string;
  scope?: string;
  createdAt: number;
  updatedAt: number;
  totalSize: number;
  downloadCount: number;
}

export interface PackageVersion {
  version: string;
  size: number;
  filePath: string;
  sha1?: string;
  publishedAt: number;
  downloadCount: number;
}

export interface CacheStats {
  totalPackages: number;
  totalVersions: number;
  totalSize: number;
  npmPackages: number;
  pypiPackages: number;
  privatePackages: number;
  cachePackages: number;
  maxSize: number;
  usagePercent: number;
}

export interface StorageTrend {
  date: string;
  size: number;
  packages: number;
}

export interface CachePolicy {
  maxSizeGB: number;
  maxAgeDays: number;
  autoClean: boolean;
}
