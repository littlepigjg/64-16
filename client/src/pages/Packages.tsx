import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Lock,
  Download,
  Box,
  Archive,
  Database,
  Loader2,
  ArrowUpDown,
  TrendingUp,
} from 'lucide-react';
import { api } from '../api';
import type { PackageInfo, RegistryType, PackageSource } from '../types';
import { formatSize, formatRelativeTime } from '../utils';

type SortBy = 'name' | 'updatedAt' | 'size' | 'downloads';

export default function Packages() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [packages, setPackages] = useState<PackageInfo[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [registry, setRegistry] = useState<RegistryType | ''>(
    (searchParams.get('registry') as RegistryType) || ''
  );
  const [source, setSource] = useState<PackageSource | ''>(
    (searchParams.get('source') as PackageSource) || ''
  );
  const [sortBy, setSortBy] = useState<SortBy>(
    (searchParams.get('sortBy') as SortBy) || 'updatedAt'
  );
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(
    (searchParams.get('sortOrder') as 'asc' | 'desc') || 'desc'
  );
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const loadPackages = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.listPackages({
        registry: registry || undefined,
        source: source || undefined,
        search: search || undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize,
        sortBy,
        sortOrder,
      });
      setPackages(result.packages);
      setTotal(result.total);
    } finally {
      setLoading(false);
    }
  }, [search, registry, source, sortBy, sortOrder, page]);

  useEffect(() => {
    const p = searchParams.get('page');
    if (p) setPage(parseInt(p, 10));
  }, [searchParams]);

  useEffect(() => {
    loadPackages();
  }, [loadPackages]);

  const handleDelete = async (pkg: PackageInfo, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`确认删除包 ${pkg.name}（包含所有版本）？此操作不可恢复。`)) return;
    await api.deletePackage(pkg.registry, pkg.name);
    loadPackages();
  };

  const handleSort = (col: SortBy) => {
    if (sortBy === col) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(col);
      setSortOrder('desc');
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">包列表</h1>
          <p className="text-sm text-slate-500 mt-1">
            管理本地缓存的 NPM 和 PyPI 包，共 {total} 个
          </p>
        </div>
      </div>

      <div className="card p-4 space-y-4">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[240px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="搜索包名..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>

          <select
            className="select"
            value={registry}
            onChange={(e) => {
              setRegistry(e.target.value as RegistryType | '');
              setPage(1);
            }}
          >
            <option value="">全部仓库</option>
            <option value="npm">📦 NPM</option>
            <option value="pypi">🐍 PyPI</option>
          </select>

          <select
            className="select"
            value={source}
            onChange={(e) => {
              setSource(e.target.value as PackageSource | '');
              setPage(1);
            }}
          >
            <option value="">全部来源</option>
            <option value="cache">💾 代理缓存</option>
            <option value="private">🔒 私有包</option>
          </select>

          <div className="flex items-center gap-1 text-slate-400 text-sm">
            <Filter size={14} />
            已筛选
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th className="w-10"></th>
                <th className="cursor-pointer select-none" onClick={() => handleSort('name')}>
                  <span className="flex items-center gap-1">
                    包名 <ArrowUpDown size={12} />
                  </span>
                </th>
                <th>仓库</th>
                <th>来源</th>
                <th className="cursor-pointer select-none" onClick={() => handleSort('size')}>
                  <span className="flex items-center gap-1">
                    占用空间 <ArrowUpDown size={12} />
                  </span>
                </th>
                <th>最新版本</th>
                <th className="cursor-pointer select-none" onClick={() => handleSort('downloads')}>
                  <span className="flex items-center gap-1">
                    下载次数 <ArrowUpDown size={12} />
                  </span>
                </th>
                <th className="cursor-pointer select-none" onClick={() => handleSort('updatedAt')}>
                  <span className="flex items-center gap-1">
                    更新时间 <ArrowUpDown size={12} />
                  </span>
                </th>
                <th className="w-20 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={9} className="py-12 text-center">
                    <Loader2 className="animate-spin text-indigo-600 mx-auto" size={24} />
                  </td>
                </tr>
              )}

              {!loading && packages.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-16 text-center">
                    <Box size={48} className="mx-auto text-slate-300 mb-3" />
                    <p className="text-slate-500">暂无符合条件的包</p>
                    <p className="text-sm text-slate-400 mt-1">
                      尝试通过代理安装一些包，或上传你的私有包
                    </p>
                  </td>
                </tr>
              )}

              {!loading &&
                packages.map((pkg) => (
                  <tr
                    key={`${pkg.registry}-${pkg.name}`}
                    className="cursor-pointer"
                    onClick={() => navigate(`/packages/${pkg.registry}/${encodeURIComponent(pkg.name)}`)}
                  >
                    <td>
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                          pkg.registry === 'npm' ? 'bg-orange-50 text-orange-600' : 'bg-sky-50 text-sky-600'
                        }`}
                      >
                        {pkg.registry === 'npm' ? <Archive size={16} /> : <Database size={16} />}
                      </div>
                    </td>
                    <td>
                      <div className="font-medium text-slate-800">{pkg.name}</div>
                      {pkg.description && (
                        <div className="text-xs text-slate-400 mt-0.5 truncate max-w-md">
                          {pkg.description}
                        </div>
                      )}
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          pkg.registry === 'npm'
                            ? 'bg-orange-100 text-orange-700'
                            : 'bg-sky-100 text-sky-700'
                        }`}
                      >
                        {pkg.registry.toUpperCase()}
                      </span>
                    </td>
                    <td>
                      {pkg.source === 'private' ? (
                        <span className="badge bg-rose-100 text-rose-700">
                          <Lock size={10} className="mr-1" /> 私有
                        </span>
                      ) : (
                        <span className="badge bg-emerald-100 text-emerald-700">
                          💾 缓存
                        </span>
                      )}
                    </td>
                    <td className="font-mono text-sm text-slate-700">
                      {formatSize(pkg.totalSize)}
                      <div className="text-xs text-slate-400">
                        {pkg.versions.length} 个版本
                      </div>
                    </td>
                    <td className="font-mono text-sm text-slate-700">
                      {pkg.latestVersion || '-'}
                    </td>
                    <td>
                      <span className="inline-flex items-center gap-1 text-sm text-slate-600">
                        <TrendingUp size={12} />
                        {pkg.downloadCount}
                      </span>
                    </td>
                    <td className="text-sm text-slate-500">{formatRelativeTime(pkg.updatedAt)}</td>
                    <td className="text-right">
                      <button
                        className="btn btn-ghost p-2 text-slate-400 hover:text-red-600 hover:bg-red-50"
                        onClick={(e) => handleDelete(pkg, e)}
                        title="删除"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between p-4 border-t border-slate-100">
            <div className="text-sm text-slate-500">
              第 {page} / {totalPages} 页，共 {total} 条
            </div>
            <div className="flex items-center gap-1">
              <button
                className="btn btn-ghost p-2"
                disabled={page === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft size={16} />
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pn: number;
                if (totalPages <= 5) {
                  pn = i + 1;
                } else if (page <= 3) {
                  pn = i + 1;
                } else if (page >= totalPages - 2) {
                  pn = totalPages - 4 + i;
                } else {
                  pn = page - 2 + i;
                }
                return (
                  <button
                    key={pn}
                    className={`btn p-2 min-w-9 ${
                      pn === page ? 'btn-primary' : 'btn-ghost'
                    }`}
                    onClick={() => setPage(pn)}
                  >
                    {pn}
                  </button>
                );
              })}
              <button
                className="btn btn-ghost p-2"
                disabled={page === totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
