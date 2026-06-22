import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Packages from './pages/Packages';
import Settings from './pages/Settings';
import PackageDetail from './pages/PackageDetail';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="packages" element={<Packages />} />
        <Route path="packages/:registry/:name" element={<PackageDetail />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
