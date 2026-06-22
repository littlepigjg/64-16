import { useEffect, useState } from 'react';
import {
  Package as PackageIcon,
  Database,
  Archive,
  Lock,
  HardDrive,
  TrendingUp,
  TrendingDown,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from 'recharts';
import { api } from '../api';
import type { CacheStats, StorageTrend } from '../types';
import { formatSize, formatNumber } from '../utils';

export default function Dashboard() {
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [trend, setTrend] = useState<StorageTrend[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      const [s, t] = await Promise.all([api.getStats(), api.getTrend(30)]);
      setStats(s);
      setTrend(t);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin text-indigo-600" size={32} />
      </div>
    );
  }

  const statCards = stats
    ? [
        {
          label: '缓存包总数',
          value: formatNumber(stats.totalPackages),
          sub: `${formatNumber(stats.totalVersions)} 个版本`,
          icon: PackageIcon,
          color: 'from-indigo-500 to-indigo-600',
          bg: 'bg-indigo-50',
          text: 'text-indigo-600',
        },
        {
          label: '存储占用',
          value: formatSize(stats.totalSize),
          sub: `${stats.usagePercent.toFixed(1)}% 已使用`,
          icon: HardDrive,
          color: 'from-emerald-500 to-emerald-600',
          bg: 'bg-emerald-50',
          text: 'text-emerald-600',
        },
        {
          label: 'NPM 包',
          value: formatNumber(stats.npmPackages),
          sub: 'NPM Registry',
          icon: Archive,
          color: 'from-orange-500 to-orange-600',
          bg: 'bg-orange-50',
          text: 'text-orange-600',
        },
        {
          label: 'PyPI 包',
          value: formatNumber(stats.pypiPackages),
          sub: 'Python 包',
          icon: Database,
          color: 'from-sky-500 to-sky-600',
          bg: 'bg-sky-50',
          text: 'text-sky-600',
        },
        {
          label: '私有包',
          value: formatNumber(stats.privatePackages),
          sub: 'Scope 隔离',
          icon: Lock,
          color: 'from-rose-500 to-rose-600',
          bg: 'bg-rose-50',
          text: 'text-rose-600',
        },
        {
          label: '代理缓存包',
          value: formatNumber(stats.cachePackages),
          sub: '从官方仓库缓存',
          icon: TrendingDown,
          color: 'from-violet-500 to-violet-600',
          bg: 'bg-violet-50',
          text: 'text-violet-600',
        },
      ]
    : [];

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">统计面板</h1>
          <p className="text-sm text-slate-500 mt-1">
            概览本地镜像仓库的存储和使用情况
          </p>
        </div>
        <button className="btn btn-secondary" onClick={loadData}>
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          刷新数据
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {statCards.map((card, i) => {
          const Icon = card.icon;
          return (
            <div key={i} className="card p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-slate-500">{card.label}</p>
                  <p className="text-2xl font-bold text-slate-800 mt-1">{card.value}</p>
                  <p className="text-xs text-slate-400 mt-1">{card.sub}</p>
                </div>
                <div className={`w-11 h-11 rounded-xl ${card.bg} ${card.text} flex items-center justify-center`}>
                  <Icon size={22} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {stats && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-800">存储使用率</h2>
              <p className="text-sm text-slate-500">
                当前 {formatSize(stats.totalSize)} / 上限 {formatSize(stats.maxSize)}
              </p>
            </div>
            <span
              className={`badge ${
                stats.usagePercent >= 80
                  ? 'bg-red-100 text-red-700'
                  : stats.usagePercent >= 60
                  ? 'bg-yellow-100 text-yellow-700'
                  : 'bg-emerald-100 text-emerald-700'
              }`}
            >
              {stats.usagePercent.toFixed(1)}%
            </span>
          </div>
          <div className="progress-bar">
            <div
              className={`progress-fill ${
                stats.usagePercent >= 80
                  ? 'bg-red-500'
                  : stats.usagePercent >= 60
                  ? 'bg-yellow-500'
                  : 'bg-gradient-to-r from-indigo-500 to-emerald-500'
              }`}
              style={{ width: `${Math.min(100, stats.usagePercent)}%` }}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">存储增长趋势</h2>
          <div className="h-72">
            {trend.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="sizeGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => formatSize(v as number)}
                    width={70}
                  />
                  <Tooltip
                    formatter={(v: number) => formatSize(v)}
                    labelFormatter={(l) => `日期: ${l}`}
                    contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="size"
                    stroke="#6366f1"
                    strokeWidth={2}
                    fill="url(#sizeGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-400 text-sm">
                暂无趋势数据，系统运行一段时间后将自动记录
              </div>
            )}
          </div>
        </div>

        <div className="card p-6">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">包数量趋势</h2>
          <div className="h-72">
            {trend.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trend} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    axisLine={false}
                    tickLine={false}
                    width={50}
                  />
                  <Tooltip
                    formatter={(v: number) => formatNumber(v)}
                    labelFormatter={(l) => `日期: ${l}`}
                    contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }}
                  />
                  <Bar dataKey="packages" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-400 text-sm">
                暂无趋势数据
              </div>
            )}
          </div>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="card p-5 md:col-span-2">
            <h3 className="text-sm font-medium text-slate-500 mb-3">按来源分布</h3>
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-slate-600">代理缓存 (NPM + PyPI)</span>
                  <span className="font-semibold text-slate-800">
                    {formatNumber(stats.cachePackages)}
                  </span>
                </div>
                <div className="progress-bar">
                  <div
                    className="progress-fill bg-indigo-500"
                    style={{
                      width: `${stats.totalPackages > 0 ? (stats.cachePackages / stats.totalPackages) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-slate-600">私有包 (Scope)</span>
                  <span className="font-semibold text-slate-800">
                    {formatNumber(stats.privatePackages)}
                  </span>
                </div>
                <div className="progress-bar">
                  <div
                    className="progress-fill bg-rose-500"
                    style={{
                      width: `${stats.totalPackages > 0 ? (stats.privatePackages / stats.totalPackages) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="card p-5 md:col-span-2">
            <h3 className="text-sm font-medium text-slate-500 mb-3">按仓库分布</h3>
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-slate-600">NPM Registry</span>
                  <span className="font-semibold text-slate-800">
                    {formatNumber(stats.npmPackages)}
                  </span>
                </div>
                <div className="progress-bar">
                  <div
                    className="progress-fill bg-orange-500"
                    style={{
                      width: `${stats.totalPackages > 0 ? (stats.npmPackages / stats.totalPackages) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-slate-600">PyPI Index</span>
                  <span className="font-semibold text-slate-800">
                    {formatNumber(stats.pypiPackages)}
                  </span>
                </div>
                <div className="progress-bar">
                  <div
                    className="progress-fill bg-sky-500"
                    style={{
                      width: `${stats.totalPackages > 0 ? (stats.pypiPackages / stats.totalPackages) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
