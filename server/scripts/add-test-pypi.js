const path = require('path');
const fs = require('fs');

const dataDir = path.resolve(__dirname, '..', '..', 'data');
const dbPath = path.join(dataDir, 'registry-data.json');

if (!fs.existsSync(dbPath)) {
  console.error('No data file found. Please start the server first.');
  process.exit(1);
}

const db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));

const now = Date.now();

function addPypiPackage({ name, source, version, size }) {
  const existing = db.packages.find(p => p.name === name && p.registry === 'pypi');
  let pkgId;

  if (existing) {
    pkgId = existing.id;
    console.log(`Package already exists: ${name} (id=${pkgId})`);
  } else {
    pkgId = db.nextPackageId++;
    db.packages.push({
      id: pkgId,
      name,
      registry: 'pypi',
      source,
      latestVersion: version,
      createdAt: now - 100000,
      updatedAt: now,
      totalSize: size,
      downloadCount: Math.floor(Math.random() * 100),
    });
    console.log(`Added package: ${name} (source=${source}, id=${pkgId})`);
  }

  const filePath = path.resolve(__dirname, '..', '..', 'storage', 'pypi', source === 'private' ? 'private' : 'cache', name, version, `${name}-${version}.tar.gz`);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(filePath)) {
    const dummy = Buffer.alloc(size, name);
    fs.writeFileSync(filePath, dummy);
  }

  const existingVer = db.versions.find(v => v.packageId === pkgId && v.version === version);
  if (!existingVer) {
    const vid = db.nextVersionId++;
    db.versions.push({
      id: vid,
      packageId: pkgId,
      version,
      size,
      filePath: filePath.replace(/\\/g, '/'),
      publishedAt: now,
      downloadCount: 0,
    });
    console.log(`  Added version: ${version} (${size} bytes)`);
  } else {
    console.log(`  Version already exists: ${version}`);
  }
}

addPypiPackage({ name: 'requests', source: 'cache', version: '2.32.3', size: 45892 });
addPypiPackage({ name: 'requests', source: 'cache', version: '2.31.0', size: 43987 });
addPypiPackage({ name: 'flask', source: 'cache', version: '3.0.3', size: 30215 });
addPypiPackage({ name: 'numpy', source: 'cache', version: '2.1.0', size: 15234891 });
addPypiPackage({ name: '@local/my-utils', source: 'private', version: '1.0.0', size: 12456 });
addPypiPackage({ name: '@local/my-utils', source: 'private', version: '1.1.0', size: 15892 });
addPypiPackage({ name: '@private/internal-lib', source: 'private', version: '0.1.0', size: 8765 });

fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
console.log('\nDone. Total PyPI packages:', db.packages.filter(p => p.registry === 'pypi').length);
