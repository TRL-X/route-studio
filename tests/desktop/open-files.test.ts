import { mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { OpenFileInbox, readDesktopFile, routePaths } from '../../electron/open-files';
import { maxFileBytes } from '../../electron/security';

describe('OS file requests', () => {
  it('accepts local paths and file URLs, resolves the sending process cwd, and ignores switches and other types', () => {
    const cwd = path.resolve('routes');
    const filename = path.join(cwd, '山脊 loop.FIT');
    expect(
      routePaths(
        [
          '--disable-updates',
          '--user-data-dir=profile.gpx',
          'trail.GPX',
          filename,
          pathToFileURL(path.join(cwd, 'a b.kml')).href,
          '../route.rte',
          'project.routeproj',
          'https://example.org/route.gpx',
          'file:///%xx.gpx',
          'bad\0.gpx',
        ],
        cwd,
      ),
    ).toEqual([
      path.join(cwd, 'trail.GPX'),
      filename,
      path.join(cwd, 'a b.kml'),
      path.resolve(cwd, '../route.rte'),
    ]);
  });

  it('retains requests across renderer reloads, batches paths, and ignores stale acknowledgments', () => {
    const inbox = new OpenFileInbox();
    const a = path.resolve('a.gpx');
    const b = path.resolve('b.fit');
    inbox.enqueue([a, a, b]);
    const first = inbox.claim()!;
    expect(first.names).toEqual(['a.gpx', 'b.fit']);
    expect(inbox.claim()).toEqual(first);
    inbox.enqueue([a, path.resolve('next.rte')]);
    inbox.finish('stale');
    expect(inbox.filename(first.id, 1)).toBe(b);
    for (const index of [-1, 2, 0.5, '0', null]) expect(() => inbox.filename(first.id, index)).toThrow();
    expect(() => inbox.filename('../a.gpx', 0)).toThrow();
    inbox.finish(first.id);
    const next = inbox.claim()!;
    expect(next.names).toEqual(['next.rte']);
    inbox.finish(first.id);
    expect(inbox.claim()).toEqual(next);
    inbox.finish(next.id);
    expect(inbox.claim()).toBeNull();
    expect(inbox.hasFiles).toBe(false);
    inbox.enqueue([a]);
    expect(inbox.claim()!.names).toEqual(['a.gpx']);
  });
});

describe('native file reads', () => {
  let directory: string;
  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('reads all supported formats without imposing save-name restrictions', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'route-native-read-'));
    for (const extension of ['GPX', 'kml', 'FIT', 'rte', 'routeproj']) {
      const name = `山脊 loop.${extension}`;
      const filename = path.join(directory, name);
      await writeFile(filename, new Uint8Array([0, 1, 255]));
      expect(await readDesktopFile(filename)).toEqual({ name, bytes: new Uint8Array([0, 1, 255]) });
    }
  });

  it('rejects missing files, directories, unsupported types and oversized files', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'route-native-read-'));
    await expect(readDesktopFile(path.join(directory, 'missing.gpx'))).rejects.toThrow();
    const folder = path.join(directory, 'folder.gpx');
    await mkdir(folder);
    await expect(readDesktopFile(folder)).rejects.toThrow('Not a regular file');
    await expect(readDesktopFile(path.join(directory, 'not-a-route.exe'))).rejects.toThrow('Unsupported');
    const filename = path.join(directory, 'large.fit');
    const file = await open(filename, 'w');
    await file.truncate(maxFileBytes + 1);
    await file.close();
    await expect(readDesktopFile(filename)).rejects.toThrow('64 MiB');
  });
});
