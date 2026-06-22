import type {
  PackageListResponse,
  PackageInfo,
  CacheStats,
  StorageTrend,
  CachePolicy,
  HealthInfo,
  RegistryType,
  PackageSource,
} from './types';

const API_BASE = '/api';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  health: () => request<HealthInfo>('/health'),

  getScopes: () => request<{ scopes: string[] }>('/scopes'),

  listPackages: (params: {
    registry?: RegistryType;
    source?: PackageSource;
    search?: string;
    limit?: number;
    offset?: number;
    sortBy?: 'name' | 'updatedAt' | 'size' | 'downloads';
    sortOrder?: 'asc' | 'desc';
  } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined) qs.set(k, String(v));
    });
    return request<PackageListResponse>(`/packages?${qs.toString()}`);
  },

  getPackage: (registry: RegistryType, name: string) =>
    request<PackageInfo>(`/packages/${registry}/${encodeURIComponent(name)}`),

  deletePackage: (registry: RegistryType, name: string) =>
    request<{ success: boolean; deleted: string }>(
      `/packages/${registry}/${encodeURIComponent(name)}`,
      { method: 'DELETE' }
    ),

  deleteVersion: (registry: RegistryType, name: string, version: string) =>
    request<{ success: boolean; deleted: string }>(
      `/packages/${registry}/${encodeURIComponent(name)}/versions/${version}`,
      { method: 'DELETE' }
    ),

  cleanupUnused: (registry: RegistryType, name: string, keep: number = 3) =>
    request<{ success: boolean; kept: number; deleted: string[] }>(
      `/packages/${registry}/${encodeURIComponent(name)}/cleanup-unused?keep=${keep}`,
      { method: 'POST' }
    ),

  getStats: () => request<CacheStats>('/stats'),

  getTrend: (days: number = 30) =>
    request<StorageTrend[]>(`/stats/trend?days=${days}`),

  getCachePolicy: () => request<CachePolicy>('/cache/policy'),

  updateCachePolicy: (policy: CachePolicy) =>
    request<{ success: boolean; policy: CachePolicy }>('/cache/policy', {
      method: 'PUT',
      body: JSON.stringify(policy),
    }),

  runCleanup: () =>
    request<{ success: boolean; deletedFiles: number; freedBytes: number }>(
      '/cache/cleanup',
      { method: 'POST' }
    ),

  snapshot: () =>
    request<{ success: boolean; timestamp: number }>('/cache/snapshot', {
      method: 'POST',
    }),
};
