import { useEffect, useState } from 'react';
import {
  Settings as SettingsIcon,
  HardDrive,
  Clock,
  Trash2,
  Loader2,
  ShieldAlert,
  Play,
  CheckCircle2,
  Database,
} from 'lucide-react';
import { api } from '../api';
import type { CachePolicy, HealthInfo } from '../types';
import { formatSize } from '../utils';

export default function Settings() {
  const [policy, setPolicy] = useState<CachePolicy | null>(null);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleanResult, setCleanResult] = useState<{ deletedFiles: number; freedBytes: number } | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [p, h] = await Promise.all([api.getCachePolicy(), api.health()]);
      setPolicy(p);
      setHealth(h);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSave = async () => {
    if (!policy) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      await api.updateCachePolicy(policy);
      setSaveMsg('success');
      setTimeout(() => setSaveMsg(null), 3000);
    } finally {
      setSaving(false);
    }
  };

  const handleCleanup = async () => {
    if (!confirm('根据当前缓存策略执行清理？过期文件和超出存储上限的缓存将被删除。')) return;
    setCleaning(true);
    setCleanResult(null);
    try {
      const r = await api.runCleanup();
      setCleanResult({ deletedFiles: r.deletedFiles, freedBytes: r.freedBytes });
    } finally {
      setCleaning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin text-indigo-600" size={32} />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">缓存策略设置</h1>
        <p className="text-sm text-slate-500 mt-1">配置本地缓存的存储上限、过期策略和清理规则</p>
      </div>

      <div className="card p-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-5 flex items-center gap-2">
          <SettingsIcon size={20} /> 存储策略
        </h2>

        {policy && (
          <div className="space-y-6">
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-2">
                <HardDrive size={16} className="text-slate-400" /> 存储上限 (GB)
              </label>
              <input
                type="number"
                className="input max-w-xs"
                min={0.1}
                step={0.5}
                value={policy.maxSizeGB}
                onChange={(e) =>
                  setPolicy({ ...policy, maxSizeGB: parseFloat(e.target.value) || 0 })
                }
              />
              <p className="text-xs text-slate-500 mt-1.5">
                缓存占用超过此阈值时，将自动清理最少使用的缓存包
              </p>
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-2">
                <Clock size={16} className="text-slate-400" /> 缓存过期天数
              </label>
              <input
                type="number"
                className="input max-w-xs"
                min={0}
                step={1}
                value={policy.maxAgeDays}
                onChange={(e) =>
                  setPolicy({ ...policy, maxAgeDays: parseInt(e.target.value, 10) || 0 })
                }
              />
              <p className="text-xs text-slate-500 mt-1.5">
                超过此天数未被访问的缓存包将被自动清理；设为 0 表示永不过期
              </p>
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-2">
                <ShieldAlert size={16} className="text-slate-400" /> 自动清理
              </label>
              <label className="inline-flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="w-5 h-5 rounded border-slate-300 text-indigo-600"
                  checked={policy.autoClean}
                  onChange={(e) => setPolicy({ ...policy, autoClean: e.target.checked })}
                />
                <span className="text-sm text-slate-600">
                  启动时自动根据策略清理缓存
                </span>
              </label>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving && <Loader2 size={16} className="animate-spin" />}
                {saving ? '保存中...' : '保存策略'}
              </button>
              {saveMsg === 'success' && (
                <span className="text-sm text-emerald-600 inline-flex items-center gap-1">
                  <CheckCircle2 size={16} /> 已保存
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="card p-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-5 flex items-center gap-2">
          <Trash2 size={20} /> 手动清理
        </h2>

        <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 mb-5">
          <div className="flex items-start gap-3">
            <ShieldAlert size={20} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800">
              <p className="font-medium">清理会根据当前策略删除：</p>
              <ul className="list-disc ml-4 mt-1 space-y-0.5">
                <li>超过过期天数未使用的缓存包</li>
                <li>超出存储上限部分中最久未被使用的缓存</li>
                <li><strong>私有包不会被清理</strong>，仅清理代理缓存</li>
              </ul>
            </div>
          </div>
        </div>

        <button className="btn btn-danger" onClick={handleCleanup} disabled={cleaning}>
          {cleaning ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Play size={16} />
          )}
          {cleaning ? '清理中...' : '立即执行清理'}
        </button>

        {cleanResult && (
          <div className="mt-5 p-4 rounded-lg bg-emerald-50 border border-emerald-200">
            <div className="flex items-center gap-2 text-emerald-800">
              <CheckCircle2 size={20} />
              <span className="font-medium">清理完成</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-emerald-700">删除文件：</span>
                <span className="font-semibold">{cleanResult.deletedFiles} 个</span>
              </div>
              <div>
                <span className="text-emerald-700">释放空间：</span>
                <span className="font-semibold">{formatSize(cleanResult.freedBytes)}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {health && (
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-slate-800 mb-5 flex items-center gap-2">
            <Database size={20} /> 服务配置
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ConfigRow label="服务版本" value={health.version} mono />
            <ConfigRow label="服务端口" value={`${health.config.port}`} mono />
            <ConfigRow label="存储目录" value={health.config.storageDir} mono full />
            <ConfigRow label="NPM 上游" value={health.config.npmUpstream} mono full link />
            <ConfigRow label="PyPI 上游" value={health.config.pypiUpstream} mono full link />
            <ConfigRow
              label="私有 Scope"
              value={health.config.privateScopes.join(', ')}
              mono
              full
            />
          </div>

          <div className="mt-6 p-4 rounded-lg bg-slate-50 border border-slate-200">
            <h3 className="font-medium text-slate-700 mb-3">📖 使用说明</h3>
            <div className="space-y-3 text-sm text-slate-600">
              <div>
                <p className="font-medium text-slate-700 mb-1">NPM 配置：</p>
                <code className="block bg-white border border-slate-200 px-3 py-2 rounded font-mono text-xs">
                  npm config set registry http://localhost:{health.config.port}/npm
                </code>
                <p className="text-xs text-slate-500 mt-1">
                  或单次使用：<code className="bg-white px-1.5 py-0.5 rounded border border-slate-200">npm install --registry http://localhost:{health.config.port}/npm package-name</code>
                </p>
              </div>
              <div>
                <p className="font-medium text-slate-700 mb-1">PyPI 配置：</p>
                <code className="block bg-white border border-slate-200 px-3 py-2 rounded font-mono text-xs">
                  pip install -i http://localhost:{health.config.port}/pypi/simple/ package-name
                </code>
                <p className="text-xs text-slate-500 mt-1">
                  或永久配置：<code className="bg-white px-1.5 py-0.5 rounded border border-slate-200">pip config set global.index-url http://localhost:{health.config.port}/pypi/simple/</code>
                </p>
              </div>
              <div>
                <p className="font-medium text-slate-700 mb-1">发布私有包（NPM）：</p>
                <code className="block bg-white border border-slate-200 px-3 py-2 rounded font-mono text-xs">
                  npm publish --registry http://localhost:{health.config.port}/npm
                </code>
                <p className="text-xs text-slate-500 mt-1">
                  私有包必须使用已配置的 scope：{health.config.privateScopes.map(s => `<span class="font-mono">${s}/*</span>`).join('、')}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ConfigRow({
  label,
  value,
  mono,
  full,
  link,
}: {
  label: string;
  value: string;
  mono?: boolean;
  full?: boolean;
  link?: boolean;
}) {
  return (
    <div className={`${full ? 'md:col-span-2' : ''}`}>
      <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">{label}</div>
      {link ? (
        <a
          href={value}
          target="_blank"
          rel="noreferrer"
          className={`text-slate-700 text-sm hover:text-indigo-600 break-all ${
            mono ? 'font-mono' : ''
          }`}
        >
          {value} ↗
        </a>
      ) : (
        <div className={`text-slate-700 text-sm break-all ${mono ? 'font-mono bg-slate-50 px-2 py-1 rounded' : ''}`}>
          {value}
        </div>
      )}
    </div>
  );
}
