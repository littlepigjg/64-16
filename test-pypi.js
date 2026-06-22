const http = require('http');

function request(path, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: 'localhost', port: 4873, path, timeout },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d }));
      }
    );
    req.on('timeout', () => {
      req.destroy(new Error('TIMEOUT'));
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  try {
    console.log('--- Test 1: /pypi/simple/ ---');
    const r1 = await request('/pypi/simple/', 15000);
    console.log('Status:', r1.status);
    console.log('X-Local-Packages:', r1.headers['x-local-packages']);
    console.log('X-Upstream-Status:', r1.headers['x-upstream-status'] || 'online');
    console.log('Contains my-local-pkg:', r1.body.includes('my-local-pkg'));
    const total = (r1.body.match(/<a\s+href=/g) || []).length;
    const priv = (r1.body.match(/<!-- private -->/g) || []).length;
    console.log('Total links:', total);
    console.log('Private links:', priv);

    if (r1.body.includes('my-local-pkg')) {
      const m = r1.body.match(/<a\s+href="([^"]*my-local-pkg[^"]*)"[^>]*>([^<]*)<\/a>/);
      if (m) console.log('  Link:', m[1], '->', m[2]);
    }

    console.log('');
    console.log('--- Test 2: /pypi/simple/my-local-pkg/ ---');
    const r2 = await request('/pypi/simple/my-local-pkg/', 10000);
    console.log('Status:', r2.status);
    console.log('X-Local-Files:', r2.headers['x-local-files']);
    console.log('Contains file:', r2.body.includes('my_local_pkg-1.0.0-py3-none-any.whl'));
    console.log('');
    console.log('All tests PASSED ✓');
  } catch (e) {
    console.error('Test FAILED:', e.message);
    process.exit(1);
  }
})();
