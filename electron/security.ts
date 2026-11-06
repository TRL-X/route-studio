import path from 'node:path';

export const appURL = 'app://route-studio/';
export const maxFileBytes = 64 * 1024 * 1024;
export const extensions = ['routeproj', 'rte', 'gpx', 'kml', 'fit'];

export function isAppURL(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'app:' && url.host === 'route-studio' && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function developmentURL(value?: string): string | undefined {
  if (!value) return;
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password)
    throw new Error('The desktop development server must use http://127.0.0.1.');
  return url.href;
}

export function resourcePath(root: string, value: string): string | null {
  if (!isAppURL(value)) return null;
  try {
    const pathname = decodeURIComponent(new URL(value).pathname);
    if (pathname.includes('\\') || pathname.includes('\0')) return null;
    const target = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    const relative = path.relative(root, target);
    return relative &&
      relative !== '..' &&
      !relative.startsWith('..' + path.sep) &&
      !path.isAbsolute(relative)
      ? target
      : null;
  } catch {
    return null;
  }
}

export function hasSupportedExtension(filename: string): boolean {
  return extensions.includes(path.extname(filename).slice(1).toLowerCase());
}

export function validFilename(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 180 &&
    !/[\\/:*?"<>|\u0000-\u001f]/.test(value) &&
    hasSupportedExtension(value)
  );
}
