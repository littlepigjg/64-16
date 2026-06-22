import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Trash2,
  Lock,
  Archive,
  Database,
  Download,
  Calendar,
  FileText,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { api } from '../api';
import type { PackageInfo, RegistryType } from '../types';
import { formatSize, formatDate, formatRelativeTime } from '../utils';

export default function PackageDetail() {
  const params = useParams<{ registry: RegistryType; name: string }>();
  const navigate = useNavigate();
  const [pkg, setPkg] = useState<PackageInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPkg = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getPackage(params.registry!, decodeURIComponent(params.name!));
      setPkg(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPkg();
  }, [params.registry, params.name]);

  const handleDeleteVersion = async (version: string) => {
    if (!confirm(`确认删除版本 ${pkg?.name}@${version}？`)) return;
    await api.deleteVersion(params.registry!, decodeURIComponent(params.name!), version);
    loadPkg();
  };

  const handleDeleteAll = async () => {
    if (!confirm(`确认删除包 ${pkg?.name}（包含所有 ${pkg?.versions.length} 个版本）？此操作不可恢复！`)) return;
    await api.deletePackage(params.registry!, decodeURIComponent(params.name!));
    navigate('/packages');
  };

  const handleCleanupOld = async () => {
    if (!confirm('仅保留最新 3 个版本，删除其余旧版本？')) return;
    await api.cleanupUnused(params.registry!, decodeURIComponent(params.name!), 3);
    loadPkg();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin text-indigo-600" size={32} />
      </div>
    );
  }

  if (error || !pkg) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <Link to="/packages" className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 mb-6">
          <ArrowLeft size={14} /> 返回包列表
        </Link>
        <div className="card p-12 text-center">
          <AlertTriangle size={48} className="mx-auto text-amber-500 mb-4" />
          <h2 className="text-xl font-semibold text-slate-800 mb-2">包不存在</h2>
          <p className="text-slate-500">{error || '未能找到该包的信息'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <Link to="/packages" className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={14} /> 返回包列表
      </Link>

      <div className="card p-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-start gap-4">
            <div
              className={`w-14 h-14 rounded-xl flex items-center justify-center text-white text-xl ${
                pkg.registry === 'npm'
                  ? 'bg-gradient-to-br from-orange-500 to-red-500'
                  : 'bg-gradient-to-br from-sky-500 to-blue-600'
              }`}
            >
              {pkg.registry === 'npm' ? <Archive size={28} /> : <Database size={28} />}
            </div>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold text-slate-800">{pkg.name}</h1>
                <span
                  className={`badge ${
                    pkg.registry === 'npm' ? 'bg-orange-100 text-orange-700' : 'bg-sky-100 text-sky-700'
                  }`}
                >
                  {pkg.registry.toUpperCase()}
                </span>
                {pkg.source === 'private' ? (
                  <span className="badge bg-rose-100 text-rose-700">
                    <Lock size={10} className="mr-1" /> 私有包
                  </span>
                ) : (
                  <span className="badge bg-emerald-100 text-emerald-700">💾 代理缓存</span>
                )}
              </div>
              {pkg.scope && (
                <p className="text-sm text-slate-500 mt-1">
                  Scope: <span className="font-mono bg-slate-100 px-2 py-0.5 rounded">{pkg.scope}</span>
                </p>
              )}
              {pkg.description && (
                <p className="text-slate-600 mt-2 max-w-2xl">{pkg.description}</p>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            {pkg.versions.length > 3 && (
              <button className="btn btn-secondary" onClick={handleCleanupOld}>
                清理旧版本
              </button>
            )}
            <button className="btn btn-danger" onClick={handleDeleteAll}>
              <Trash2 size={16} /> 删除包
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-8 pt-6 border-t border-slate-100">
          <InfoCard icon={Archive} label="最新版本" value={pkg.latestVersion || '-'} />
          <InfoCard icon={FileText} label="版本数量" value={`${pkg.versions.length}`} />
          <InfoCard icon={Database} label="总占用" value={formatSize(pkg.totalSize)} />
          <InfoCard icon={Download} label="下载次数" value={`${pkg.downloadCount}`} />
          <InfoCard icon={Calendar} label="最后更新" value={formatRelativeTime(pkg.updatedAt)} />
        </div>

        {(pkg.author || pkg.license) && (
          <div className="mt-6 pt-6 border-t border-slate-100 grid grid-cols-2 gap-4">
            {pkg.author && (
              <div>
                <span className="text-xs text-slate-400 uppercase tracking-wide">作者</span>
                <p className="text-slate-700 mt-1">{pkg.author}</p>
              </div>
            )}
            {pkg.license && (
              <div>
                <span className="text-xs text-slate-400 uppercase tracking-wide">许可证</span>
                <p className="text-slate-700 mt-1">{pkg.license}</p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-800">版本列表</h2>
          <span className="text-sm text-slate-500">{pkg.versions.length} 个版本</span>
        </div>

        <div className="space-y-2">
          {pkg.versions.map((ver) => (
            <div
              key={ver.version}
              className="flex items-center justify-between p-4 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-mono font-bold text-sm">
                  v{ver.version.split('.')[0]}
                </div>
                <div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-semibold text-slate-800">{ver.version}</span>
                    {ver.version === pkg.latestVersion && (
                      <span className="badge bg-emerald-100 text-emerald-700">最新</span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <Calendar size={12} /> {formatDate(ver.publishedAt)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Database size={12} /> {formatSize(ver.size)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Download size={12} /> {ver.downloadCount} 次
                    </span>
                  </div>
                </div>
              </div>
              <button
                className="btn btn-ghost p-2 text-slate-400 hover:text-red-600 hover:bg-red-50"
                onClick={() => handleDeleteVersion(ver.version)}
                title="删除此版本"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function InfoCard({
  icon: Icon,
  label,
  value,
}: {
  icon: any;
  label: string;
  value: string;
}) {
  return (
    <div className="p-4 rounded-lg bg-slate-50">
      <div className="flex items-center gap-2 text-slate-500 text-xs">
        <Icon size={14} />
        {label}
      </div>
      <div className="mt-1.5 font-semibold text-slate-800 truncate">{value}</div>
    </div>
  );
}
