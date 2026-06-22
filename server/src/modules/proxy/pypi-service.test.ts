import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Response } from 'express';
import {
  parsePypiSimpleIndex,
  renderPypiSimpleIndex,
  parsePypiPackageLinks,
  renderPypiPackageLinks,
  normalizePypiName,
  pypiNamesMatch,
  PypiFileLink,
} from './utils';
import {
  mergeSimpleIndex,
  mergePackageFiles,
  sendSimpleIndex,
  sendPackageLinks,
  sendNotFoundHtml,
  sendUpstreamErrorHtml,
  sendUpstreamIndexErrorHtml,
  sendUpstreamUnavailableIndexHtml,
  sendUpstreamUnavailableError,
} from './pypi-service';

vi.mock('../metadata', () => ({
  getMetadataIndex: vi.fn(),
}));

vi.mock('../cache', () => ({
  getCacheStorage: vi.fn(),
}));

describe('PyPI Utils', () => {
  describe('parsePypiSimpleIndex', () => {
    it('should parse simple index HTML', () => {
      const html = `<!DOCTYPE html>
<html>
  <body>
    <a href="package1/">package1</a>
    <a href="package2/">package2</a>
  </body>
</html>`;

      const result = parsePypiSimpleIndex(html);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('package1');
      expect(result[0].href).toBe('package1/');
      expect(result[1].name).toBe('package2');
      expect(result[1].href).toBe('package2/');
    });

    it('should return empty array for empty HTML', () => {
      const result = parsePypiSimpleIndex('<html><body></body></html>');
      expect(result).toHaveLength(0);
    });
  });

  describe('renderPypiSimpleIndex', () => {
    it('should render simple index HTML', () => {
      const packages = [
        { name: 'package1', href: './package1/' },
        { name: 'package2', href: './package2/' },
      ];

      const html = renderPypiSimpleIndex(packages);
      expect(html).toContain('package1');
      expect(html).toContain('package2');
      expect(html).toContain('<a href="./package1/">package1</a>');
      expect(html).toContain('<a href="./package2/">package2</a>');
    });

    it('should sort packages alphabetically', () => {
      const packages = [
        { name: 'z-package' },
        { name: 'a-package' },
      ];

      const html = renderPypiSimpleIndex(packages);
      const aIndex = html.indexOf('a-package');
      const zIndex = html.indexOf('z-package');
      expect(aIndex).toBeLessThan(zIndex);
    });
  });

  describe('parsePypiPackageLinks', () => {
    it('should parse package links HTML', () => {
      const html = `<!DOCTYPE html>
<html>
  <body>
    <h1>Links for test-package</h1>
    <a href="test-package-1.0.0.tar.gz#sha256=abc123" data-requires-python="&gt;=3.6">test-package-1.0.0.tar.gz</a><br/>
    <a href="test-package-2.0.0.tar.gz#sha256=def456">test-package-2.0.0.tar.gz</a><br/>
  </body>
</html>`;

      const result = parsePypiPackageLinks(html);
      expect(result).toHaveLength(2);
      expect(result[0].filename).toBe('test-package-1.0.0.tar.gz');
      expect(result[0].hash).toBe('abc123');
      expect(result[0].requiresPython).toBe('>=3.6');
      expect(result[1].filename).toBe('test-package-2.0.0.tar.gz');
      expect(result[1].hash).toBe('def456');
    });
  });

  describe('renderPypiPackageLinks', () => {
    it('should render package links HTML', () => {
      const files: PypiFileLink[] = [
        { filename: 'pkg-1.0.0.tar.gz', href: '/files/pkg/1.0.0/pkg-1.0.0.tar.gz', hash: 'abc123' },
        { filename: 'pkg-2.0.0.tar.gz', href: '/files/pkg/2.0.0/pkg-2.0.0.tar.gz', requiresPython: '>=3.6' },
      ];

      const html = renderPypiPackageLinks('test-pkg', files);
      expect(html).toContain('Links for test-pkg');
      expect(html).toContain('pkg-1.0.0.tar.gz');
      expect(html).toContain('pkg-2.0.0.tar.gz');
      expect(html).toContain('data-requires-python="&gt;=3.6"');
    });
  });

  describe('normalizePypiName', () => {
    it('should normalize package names', () => {
      expect(normalizePypiName('Package_Name')).toBe('package-name');
      expect(normalizePypiName('package.name')).toBe('package-name');
      expect(normalizePypiName('package--name')).toBe('package-name');
      expect(normalizePypiName('Package-Name')).toBe('package-name');
    });
  });

  describe('pypiNamesMatch', () => {
    it('should match normalized names', () => {
      expect(pypiNamesMatch('Package_Name', 'package-name')).toBe(true);
      expect(pypiNamesMatch('test.pkg', 'test-pkg')).toBe(true);
      expect(pypiNamesMatch('different', 'names')).toBe(false);
    });
  });
});

describe('PyPI Service - Merge Functions', () => {
  describe('mergeSimpleIndex', () => {
    it('should merge local and upstream packages', () => {
      const local = new Map([
        ['package-a', { name: 'package-a', private: false }],
        ['package-b', { name: 'package-b', private: true }],
      ]);
      const upstream = [
        { name: 'package-a', href: '/package-a/' },
        { name: 'package-c', href: '/package-c/' },
      ];

      const merged = mergeSimpleIndex(local, upstream);
      expect(merged).toHaveLength(3);
      const names = merged.map(m => m.name);
      expect(names).toContain('package-a');
      expect(names).toContain('package-b');
      expect(names).toContain('package-c');
    });

    it('should prefer local packages over upstream', () => {
      const local = new Map([
        ['package-a', { name: 'Local-Package-A', private: true }],
      ]);
      const upstream = [
        { name: 'Package-A', href: '/Package-A/' },
      ];

      const merged = mergeSimpleIndex(local, upstream);
      expect(merged).toHaveLength(1);
      expect(merged[0].name).toBe('Local-Package-A');
      expect(merged[0].private).toBe(true);
    });
  });

  describe('mergePackageFiles', () => {
    it('should merge local and upstream files', () => {
      const local: PypiFileLink[] = [
        { filename: 'pkg-1.0.0.tar.gz', href: '/local/pkg-1.0.0.tar.gz' },
        { filename: 'pkg-2.0.0.tar.gz', href: '/local/pkg-2.0.0.tar.gz' },
      ];
      const upstream: PypiFileLink[] = [
        { filename: 'pkg-2.0.0.tar.gz', href: '/upstream/pkg-2.0.0.tar.gz' },
        { filename: 'pkg-3.0.0.tar.gz', href: '/upstream/pkg-3.0.0.tar.gz' },
      ];

      const merged = mergePackageFiles(local, upstream);
      expect(merged).toHaveLength(3);
      const filenames = merged.map(f => f.filename);
      expect(filenames).toContain('pkg-1.0.0.tar.gz');
      expect(filenames).toContain('pkg-2.0.0.tar.gz');
      expect(filenames).toContain('pkg-3.0.0.tar.gz');
    });

    it('should prefer local files over upstream with same name', () => {
      const local: PypiFileLink[] = [
        { filename: 'pkg-1.0.0.tar.gz', href: '/local/pkg-1.0.0.tar.gz', hash: 'local-hash' },
      ];
      const upstream: PypiFileLink[] = [
        { filename: 'pkg-1.0.0.tar.gz', href: '/upstream/pkg-1.0.0.tar.gz', hash: 'upstream-hash' },
      ];

      const merged = mergePackageFiles(local, upstream);
      expect(merged).toHaveLength(1);
      expect(merged[0].href).toBe('/local/pkg-1.0.0.tar.gz');
      expect(merged[0].hash).toBe('local-hash');
    });

    it('should sort files alphabetically', () => {
      const local: PypiFileLink[] = [
        { filename: 'pkg-2.0.0.tar.gz', href: '/pkg-2.0.0.tar.gz' },
      ];
      const upstream: PypiFileLink[] = [
        { filename: 'pkg-1.0.0.tar.gz', href: '/pkg-1.0.0.tar.gz' },
      ];

      const merged = mergePackageFiles(local, upstream);
      expect(merged[0].filename).toBe('pkg-1.0.0.tar.gz');
      expect(merged[1].filename).toBe('pkg-2.0.0.tar.gz');
    });
  });
});

describe('PyPI Service - Response Functions', () => {
  let mockRes: Partial<Response>;
  let statusMock: vi.Mock;
  let sendMock: vi.Mock;
  let setHeaderMock: vi.Mock;
  let jsonMock: vi.Mock;

  beforeEach(() => {
    statusMock = vi.fn().mockReturnThis();
    sendMock = vi.fn().mockReturnThis();
    setHeaderMock = vi.fn().mockReturnThis();
    jsonMock = vi.fn().mockReturnThis();
    mockRes = {
      status: statusMock,
      send: sendMock,
      setHeader: setHeaderMock,
      json: jsonMock,
    };
  });

  describe('sendSimpleIndex', () => {
    it('should send simple index response', () => {
      const packages = [{ name: 'test-pkg', href: './test-pkg/' }];
      sendSimpleIndex(mockRes as Response, packages, 1, false);

      expect(setHeaderMock).toHaveBeenCalledWith('Content-Type', 'text/html; charset=utf-8');
      expect(setHeaderMock).toHaveBeenCalledWith('X-Local-Packages', '1');
      expect(sendMock).toHaveBeenCalled();
    });

    it('should set upstream status header when upstream failed', () => {
      const packages = [{ name: 'test-pkg', href: './test-pkg/' }];
      sendSimpleIndex(mockRes as Response, packages, 1, true);

      expect(setHeaderMock).toHaveBeenCalledWith('X-Upstream-Status', 'offline');
    });
  });

  describe('sendPackageLinks', () => {
    it('should send package links response', () => {
      const files: PypiFileLink[] = [{ filename: 'test.tar.gz', href: '/test.tar.gz' }];
      sendPackageLinks(mockRes as Response, 'test-pkg', files, 1, false);

      expect(setHeaderMock).toHaveBeenCalledWith('Content-Type', 'text/html; charset=utf-8');
      expect(setHeaderMock).toHaveBeenCalledWith('X-Local-Files', '1');
      expect(sendMock).toHaveBeenCalled();
    });
  });

  describe('sendNotFoundHtml', () => {
    it('should send 404 not found response', () => {
      sendNotFoundHtml(mockRes as Response, 'test-pkg');

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(sendMock).toHaveBeenCalled();
      const html = sendMock.mock.calls[0][0] as string;
      expect(html).toContain('Package not found');
      expect(html).toContain('test-pkg');
    });
  });

  describe('sendUpstreamErrorHtml', () => {
    it('should send 502 upstream error response', () => {
      sendUpstreamErrorHtml(mockRes as Response, 'test-pkg');

      expect(statusMock).toHaveBeenCalledWith(502);
      expect(sendMock).toHaveBeenCalled();
      const html = sendMock.mock.calls[0][0] as string;
      expect(html).toContain('Upstream error');
      expect(html).toContain('test-pkg');
    });
  });

  describe('sendUpstreamIndexErrorHtml', () => {
    it('should send 502 index error response', () => {
      sendUpstreamIndexErrorHtml(mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(502);
      expect(sendMock).toHaveBeenCalled();
      const html = sendMock.mock.calls[0][0] as string;
      expect(html).toContain('Upstream Error');
      expect(html).toContain('no local packages cached yet');
    });
  });

  describe('sendUpstreamUnavailableIndexHtml', () => {
    it('should send 503 unavailable index response', () => {
      sendUpstreamUnavailableIndexHtml(mockRes as Response, 30);

      expect(statusMock).toHaveBeenCalledWith(503);
      expect(setHeaderMock).toHaveBeenCalledWith('Retry-After', '30');
      expect(setHeaderMock).toHaveBeenCalledWith('X-Upstream-Status', 'unavailable');
      expect(sendMock).toHaveBeenCalled();
      const html = sendMock.mock.calls[0][0] as string;
      expect(html).toContain('Service Unavailable');
      expect(html).toContain('Circuit breaker is open');
      expect(html).toContain('30 seconds');
    });
  });

  describe('sendUpstreamUnavailableError', () => {
    it('should send 503 JSON error response', () => {
      sendUpstreamUnavailableError(mockRes as Response, 'test-pkg', 'pypi', 30);

      expect(statusMock).toHaveBeenCalledWith(503);
      expect(setHeaderMock).toHaveBeenCalledWith('Retry-After', '30');
      expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Upstream Unavailable',
        message: expect.stringContaining('test-pkg'),
        upstream: 'pypi',
        retryAfter: 30,
      }));
    });
  });
});
