import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  developmentURL,
  hasSupportedExtension,
  isAppURL,
  resourcePath,
  validFilename,
} from '../../electron/security';

describe('desktop resource boundary', () => {
  const root = path.resolve('dist');
  it('serves bundled resources and rejects other hosts and encoded traversal', () => {
    expect(resourcePath(root, 'app://route-studio/')).toBe(path.join(root, 'index.html'));
    expect(resourcePath(root, 'app://route-studio/assets/worker.js')).toBe(
      path.join(root, 'assets/worker.js'),
    );
    for (const url of [
      'app://other/index.html',
      'app://route-studio/%2e%2e%2fpackage.json',
      'app://route-studio/%2e%2e%5cpackage.json',
      'app://route-studio/%00',
      'app://route-studio/%xx',
      'file:///etc/passwd',
    ])
      expect(resourcePath(root, url)).toBeNull();
    expect(isAppURL('app://user@route-studio/index.html')).toBe(false);
  });
  it('restricts development to a loopback HTTP server', () => {
    expect(developmentURL('http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173/');
    expect(developmentURL()).toBeUndefined();
    expect(() => developmentURL('https://example.com')).toThrow();
    expect(() => developmentURL('http://127.0.0.1.evil.test')).toThrow();
  });
  it('accepts supported native file extensions regardless of platform-specific names', () => {
    for (const filename of [
      '鲲鹏径（第四段）-深圳远足径专区发布20260303更新?    .kml',
      'route:part*1?"<>|.gpx',
      'r'.repeat(181) + '.kml',
      path.join('routes', 'COURSE.GPX'),
      'route.routeproj',
      'route.rte',
      'route.fit',
    ])
      expect(hasSupportedExtension(filename)).toBe(true);
    for (const filename of ['route.exe', 'route.kml.exe', 'route', '', 'route.gpx/other.txt'])
      expect(hasSupportedExtension(filename)).toBe(false);
  });
  it('restricts renderer-provided save names to portable filenames without paths', () => {
    expect(validFilename('山脊路线.routeproj')).toBe(true);
    expect(validFilename('COURSE.GPX')).toBe(true);
    for (const name of [
      '../route.gpx',
      'C:\\route.fit',
      'route?.kml',
      'route:part.gpx',
      'r'.repeat(181) + '.kml',
      'route.exe',
      '',
      null,
    ])
      expect(validFilename(name)).toBe(false);
  });
});
