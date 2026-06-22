import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Package,
  Settings as SettingsIcon,
  Database,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { HealthInfo } from '../types';
import { formatSize } from '../utils';

const navItems = [
  { path: '/dashboard', label: '统计面板', icon: LayoutDashboard },
  { path: '/packages', label: '包列表', icon: Package },
  { path: '/settings', label: '缓存策略', icon: SettingsIcon },
];

export default function Layout() {
  const location = useLocation();
  const [health, setHealth] = useState<HealthInfo | null>(null);

  useEffect(() => {
    api.health().then(setHealth).catch(() => {});
  }, [location.pathname]);

  return (
    <div className="flex h-screen bg-slate-50">
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col">
        <div className="p-5 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xl">
              📦
            </div>
            <div>
              <h1 className="font-bold text-slate-800">Registry Proxy</h1>
              <p className="text-xs text-slate-500">本地镜像缓存系统</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-indigo-50 text-indigo-700'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`
                }
              >
                <Icon size={18} />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        {health && (
          <div className="p-4 border-t border-slate-200">
            <div className="flex items-start gap-2 p-3 rounded-lg bg-slate-50">
              <Database size={16} className="text-slate-500 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-slate-600 space-y-1">
                <div>
                  <span className="text-slate-500">存储:</span>{' '}
                  <span className="font-mono truncate block" style={{ maxWidth: 150 }}>
                    {health.config.storageDir.replace(/\\/g, '/')}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">端口:</span>{' '}
                  <span className="font-mono">{health.config.port}</span>
                </div>
                <div>
                  <span className="text-slate-500">私有 scope:</span>{' '}
                  <span className="font-mono text-indigo-600">
                    {health.config.privateScopes.join(', ')}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </aside>

      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
