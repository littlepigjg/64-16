import fs from 'fs';
import path from 'path';
import { ensureDir, sanitizePath, getDirSize } from '../../utils';
import { config } from '../../config';
import { getMetadataIndex } from '../metadata';
import type { RegistryType } from '../../types';

export class CacheStorage {
  private storageDir: string;
  private npmCacheDir: string;
  private pypiCacheDir: string;
  private npmPrivateDir: string;
  private tempDir: string;

  constructor(storageDir: string) {
    this.storageDir = storageDir;
    this.npmCacheDir = path.join(storageDir, 'npm', 'cache');
    this.pypiCacheDir = path.join(storageDir, 'pypi', 'cache');
    this.npmPrivateDir = path.join(storageDir, 'npm', 'private');
    this.tempDir = path.join(storageDir, 'tmp');
    this.ensureAllDirs();
  }

  private ensureAllDirs(): void {
    ensureDir(this.npmCacheDir);
    ensureDir(this.pypiCacheDir);
    ensureDir(this.npmPrivateDir);
    ensureDir(this.tempDir);
  }

  getNpmCachePath(packageName: string, version: string, filename: string): string {
    const safeName = sanitizePath(packageName);
    const dir = path.join(this.npmCacheDir, safeName, sanitizePath(version));
    ensureDir(dir);
    return path.join(dir, sanitizePath(filename));
  }

  getPypiCachePath(packageName: string, version: string, filename: string): string {
    const safeName = sanitizePath(packageName);
    const dir = path.join(this.pypiCacheDir, safeName, sanitizePath(version));
    ensureDir(dir);
    return path.join(dir, sanitizePath(filename));
  }

  getNpmPrivatePath(scope: string, packageName: string, version: string, filename: string): string {
    const safeScope = sanitizePath(scope);
    const safeName = sanitizePath(packageName);
    const dir = path.join(this.npmPrivateDir, safeScope, safeName, sanitizePath(version));
    ensureDir(dir);
    return path.join(dir, sanitizePath(filename));
  }

  getTempFilePath(filename: string): string {
    return path.join(this.tempDir, `${Date.now()}-${sanitizePath(filename)}`);
  }

  fileExists(filePath: string): boolean {
    return fs.existsSync(filePath);
  }

  getFileSize(filePath: string): number {
    if (!fs.existsSync(filePath)) return 0;
    return fs.statSync(filePath).size;
  }

  readStream(filePath: string): fs.ReadStream {
    return fs.createReadStream(filePath);
  }

  writeFile(filePath: string, data: Buffer | string): void {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, data);
  }

  writeStream(filePath: string): fs.WriteStream {
    ensureDir(path.dirname(filePath));
    return fs.createWriteStream(filePath);
  }

  deleteFile(filePath: string): boolean {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      this.cleanEmptyDirs(path.dirname(filePath));
      return true;
    }
    return false;
  }

  private cleanEmptyDirs(dirPath: string): void {
    const root = this.storageDir;
    let current = dirPath;
    while (current.startsWith(root) && current !== root) {
      try {
        const files = fs.readdirSync(current);
        if (files.length === 0) {
          fs.rmdirSync(current);
          current = path.dirname(current);
        } else {
          break;
        }
      } catch {
        break;
      }
    }
  }

  deletePackageFiles(name: string, registry: RegistryType, isPrivate: boolean = false): boolean {
    const metadata = getMetadataIndex();
    const pkg = metadata.getPackage(name, registry);
    if (!pkg) return false;

    let deleted = false;
    for (const version of pkg.versions) {
      if (this.deleteFile(version.filePath)) {
        deleted = true;
      }
    }
    return deleted;
  }

  deleteVersionFiles(name: string, registry: RegistryType, version: string): boolean {
    const filePath = getMetadataIndex().getVersionFilePath(name, registry, version);
    if (!filePath) return false;
    return this.deleteFile(filePath);
  }

  getTotalSize(): number {
    return getDirSize(this.storageDir);
  }

  runCacheCleanup(): { deletedFiles: number; freedBytes: number } {
    const metadata = getMetadataIndex();
    const policy = metadata.getCachePolicy();
    const stats = metadata.getStats();

    let deletedFiles = 0;
    let freedBytes = 0;
    const maxBytes = policy.maxSizeGB * 1024 * 1024 * 1024;

    if (policy.maxAgeDays > 0) {
      const oldPackages = metadata.getOldPackages(policy.maxAgeDays);
      for (const pkg of oldPackages) {
        const size = this.getFileSize(pkg.filePath);
        if (this.deleteFile(pkg.filePath)) {
          deletedFiles++;
          freedBytes += size;
        }
      }
    }

    let currentSize = stats.totalSize - freedBytes;
    if (policy.autoClean && currentSize > maxBytes) {
      const neededBytes = currentSize - maxBytes + (maxBytes * 0.05);
      const evictCandidates = metadata.getPackagesForEviction(neededBytes);
      
      for (const candidate of evictCandidates) {
        const size = this.getFileSize(candidate.filePath);
        if (this.deleteFile(candidate.filePath)) {
          metadata.deletePackageVersion(candidate.name, candidate.registry, candidate.version);
          deletedFiles++;
          freedBytes += size;
          currentSize -= size;
          if (currentSize <= maxBytes) break;
        }
      }
    }

    return { deletedFiles, freedBytes };
  }

  cleanupTemp(): void {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000;
    
    if (!fs.existsSync(this.tempDir)) return;
    
    for (const file of fs.readdirSync(this.tempDir)) {
      const filePath = path.join(this.tempDir, file);
      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > maxAge) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // ignore
      }
    }
  }
}

let cacheInstance: CacheStorage | null = null;

export function getCacheStorage(): CacheStorage {
  if (!cacheInstance) {
    cacheInstance = new CacheStorage(config.storageDir);
  }
  return cacheInstance;
}
