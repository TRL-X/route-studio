import { randomUUID } from 'node:crypto';
import { open, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DesktopFile, OpenFileRequest } from './contracts.js';
import { hasSupportedExtension, maxFileBytes } from './security.js';

const routeExtensions = new Set(['.gpx', '.kml', '.fit', '.rte']);

// Only OS/command-line paths enter this inbox. The renderer receives names and
// an opaque request ID, never an API for reading an arbitrary filesystem path.
export function routePaths(args: readonly string[], cwd: string): string[] {
  return args.flatMap((arg) => {
    if (!arg || arg.startsWith('-') || arg.includes('\0')) return [];
    try {
      const filename = arg.startsWith('file:') ? fileURLToPath(arg) : path.resolve(cwd, arg);
      if (!routeExtensions.has(path.extname(filename).toLowerCase())) return [];
      // Accept local paths and file URLs, not network URLs disguised as routes.
      if (/^[a-z][a-z\d+.-]*:\/\//i.test(arg) && !arg.startsWith('file:')) return [];
      return [filename];
    } catch {
      return [];
    }
  });
}

export class OpenFileInbox {
  private pending: string[] = [];
  private current: { id: string; paths: string[] } | null = null;

  get hasFiles() {
    return !!this.current || this.pending.length > 0;
  }

  enqueue(paths: readonly string[]) {
    const key = (filename: string) => (process.platform === 'win32' ? filename.toLowerCase() : filename);
    const seen = new Set([...this.pending, ...(this.current?.paths ?? [])].map(key));
    for (const filename of paths) {
      if (!seen.has(key(filename))) this.pending.push(filename);
      seen.add(key(filename));
    }
  }

  claim(): OpenFileRequest | null {
    if (!this.current && this.pending.length) {
      this.current = { id: randomUUID(), paths: this.pending };
      this.pending = [];
    }
    return this.current
      ? { id: this.current.id, names: this.current.paths.map((filename) => path.basename(filename)) }
      : null;
  }

  filename(id: unknown, index: unknown): string {
    if (
      !this.current ||
      id !== this.current.id ||
      typeof index !== 'number' ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= this.current.paths.length
    )
      throw new Error('Invalid file request');
    return this.current.paths[index];
  }

  finish(id: unknown) {
    if (this.current?.id === id) this.current = null;
  }
}

export async function readDesktopFile(filename: string): Promise<DesktopFile> {
  if (!hasSupportedExtension(filename)) throw new Error('Unsupported file');
  // Reject directories and special files before opening (a FIFO could block).
  if (!(await stat(filename)).isFile()) throw new Error('Not a regular file');
  const file = await open(filename, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > maxFileBytes) throw new Error('File exceeds 64 MiB');
    const bytes = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw new Error('File changed while reading');
      offset += bytesRead;
    }
    return { name: path.basename(filename), bytes: new Uint8Array(bytes) };
  } finally {
    await file.close();
  }
}
