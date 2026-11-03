import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { developmentURL, isAppURL, resourcePath, validFilename } from '../../electron/security';

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
  it('accepts supported filenames without allowing renderer paths', () => {
    expect(validFilename('山脊路线.routeproj')).toBe(true);
    expect(validFilename('COURSE.GPX')).toBe(true);
    for (const name of ['../route.gpx', 'C:\\route.fit', 'route.exe', '', null])
      expect(validFilename(name)).toBe(false);
  });
});
