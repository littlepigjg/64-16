import http from 'http';
import https from 'https';
import { URL } from 'url';

export interface UpstreamResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: Buffer;
}

export function makeRequest(
  urlStr: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: Buffer;
    timeout?: number;
  } = {}
): Promise<UpstreamResponse> {
  const timeoutMs = options.timeout || 30000;

  const reqPromise = new Promise<UpstreamResponse>((resolve, reject) => {
    const url = new URL(urlStr);
    const lib = url.protocol === 'https:' ? https : http;

    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: options.method || 'GET',
        headers: {
          'User-Agent': 'local-registry-proxy/1.0',
          Accept: '*/*',
          ...(options.headers || {}),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 500,
            headers: res.headers as Record<string, string>,
            body: Buffer.concat(chunks),
          });
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('Request timeout'));
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });

  return Promise.race([
    reqPromise,
    new Promise<UpstreamResponse>((_, reject) => {
      const t = setTimeout(() => {
        clearTimeout(t);
        reject(new Error(`Request hard timeout after ${timeoutMs}ms`));
      }, timeoutMs + 200);
    }),
  ]);
}

export interface PypiPackageLink {
  name: string;
  href: string;
}

export function parsePypiSimpleIndex(html: string): PypiPackageLink[] {
  const result: PypiPackageLink[] = [];
  const regex = /<a\s+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const href = match[1].trim();
    const name = match[2].trim();
    if (name) {
      result.push({ name, href });
    }
  }
  return result;
}

export function renderPypiSimpleIndex(packages: Array<{ name: string; href?: string; private?: boolean }>): string {
  const sorted = [...packages].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  const links = sorted
    .map((p) => {
      const href = p.href || `./${encodeURIComponent(p.name)}/`;
      const tag = p.private ? ' <!-- private -->' : '';
      return `    <a href="${href}">${escapeHtml(p.name)}</a>${tag}`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html>
  <head>
    <meta name="pypi:repository-version" content="1.0">
    <title>Simple index</title>
  </head>
  <body>
${links}
  </body>
</html>
`;
}

export interface PypiFileLink {
  filename: string;
  href: string;
  hash?: string;
  size?: number;
  requiresPython?: string;
}

export function parsePypiPackageLinks(html: string): PypiFileLink[] {
  const result: PypiFileLink[] = [];
  const regex = /<a\s+([^>]+)>([^<]+)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const attrs = match[1];
    const filename = match[2].trim();
    if (!filename) continue;

    const hrefMatch = attrs.match(/href="([^"]+)"/i);
    const href = hrefMatch ? hrefMatch[1] : '';
    if (!href) continue;

    let hash: string | undefined;
    const hashMatch = href.match(/#sha256=([a-f0-9]+)/i);
    if (hashMatch) {
      hash = hashMatch[1];
    }

    let requiresPython: string | undefined;
    const rpMatch = attrs.match(/data-requires-python="([^"]+)"/i);
    if (rpMatch) {
      try {
        requiresPython = rpMatch[1]
          .replace(/&gt;/g, '>')
          .replace(/&lt;/g, '<')
          .replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"');
      } catch {
        requiresPython = rpMatch[1];
      }
    }

    result.push({ filename, href, hash, requiresPython });
  }
  return result;
}

export function renderPypiPackageLinks(
  packageName: string,
  files: PypiFileLink[]
): string {
  const links = files
    .map((f) => {
      const attrs: string[] = [`href="${f.href}"`];
      if (f.requiresPython) {
        const escaped = f.requiresPython
          .replace(/&/g, '&amp;')
          .replace(/"/g, '&quot;')
          .replace(/>/g, '&gt;')
          .replace(/</g, '&lt;');
        attrs.push(`data-requires-python="${escaped}"`);
      }
      return `    <a ${attrs.join(' ')}>${escapeHtml(f.filename)}</a><br/>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html>
  <head>
    <meta name="pypi:repository-version" content="1.0">
    <title>Links for ${escapeHtml(packageName)}</title>
  </head>
  <body>
    <h1>Links for ${escapeHtml(packageName)}</h1>
${links}
  </body>
</html>
`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function normalizePypiName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

export function pypiNamesMatch(a: string, b: string): boolean {
  return normalizePypiName(a) === normalizePypiName(b);
}
