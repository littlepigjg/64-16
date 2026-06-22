import fs from 'fs';
import path from 'path';

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function getDirSize(dirPath: string): number {
  let totalSize = 0;
  if (!fs.existsSync(dirPath)) return 0;
  
  function walk(currentPath: string) {
    const stats = fs.statSync(currentPath);
    if (stats.isFile()) {
      totalSize += stats.size;
    } else if (stats.isDirectory()) {
      const files = fs.readdirSync(currentPath);
      for (const file of files) {
        walk(path.join(currentPath, file));
      }
    }
  }
  
  walk(dirPath);
  return totalSize;
}

export function formatDate(ts: number): string {
  return new Date(ts).toISOString().split('T')[0];
}

export function parseNpmPackageName(name: string): { scope?: string; name: string } {
  if (name.startsWith('@')) {
    const parts = name.split('/');
    return {
      scope: parts[0],
      name: parts.slice(1).join('/') || name,
    };
  }
  return { name };
}

export function sanitizePath(input: string): string {
  return input.replace(/[^a-zA-Z0-9@._\-/]/g, '_').replace(/\.\./g, '_');
}
