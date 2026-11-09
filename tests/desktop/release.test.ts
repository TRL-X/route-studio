import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { dump } from 'js-yaml';
import { verifyRelease } from '../../scripts/verify-release.mjs';

describe('release artifact validation', () => {
  it.each(['0.2.0', '0.2.0-beta.123.1'])(
    'validates Linux artifacts and the matching channel for %s',
    async (version) => {
      const directory = await mkdtemp(path.join(os.tmpdir(), 'route-release-linux-'));
      try {
        const files = [];
        for (const name of [
          `Route-Studio-${version}-linux-x86_64.AppImage`,
          `Route-Studio-${version}-linux-amd64.deb`,
        ]) {
          const contents = Buffer.from(`installer fixture: ${name}`);
          await writeFile(path.join(directory, name), contents);
          files.push({
            url: name,
            size: contents.length,
            sha512: createHash('sha512').update(contents).digest('base64'),
          });
        }
        const channel = version.includes('-') ? 'beta' : 'latest';
        await writeFile(path.join(directory, `${channel}-linux.yml`), dump({ version, files }));
        await expect(verifyRelease(directory, version, 'linux', 'x64')).resolves.toBeUndefined();
        await expect(verifyRelease(directory, '0.3.0', 'linux', 'x64')).rejects.toThrow();
        await writeFile(path.join(directory, files[0].url), 'corrupted installer');
        await expect(verifyRelease(directory, version, 'linux', 'x64')).rejects.toThrow('Size mismatch');
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it.each(['0.2.0', '0.2.0-beta.123.1'])(
    'rejects incomplete or substituted Windows artifacts for %s',
    async (version) => {
      const directory = await mkdtemp(path.join(os.tmpdir(), 'route-release-'));
      try {
        const name = `Route-Studio-${version}-win-x64.exe`;
        const contents = Buffer.from('installer fixture');
        const manifest = {
          version,
          files: [
            {
              url: name,
              size: contents.length,
              sha512: createHash('sha512').update(contents).digest('base64'),
            },
          ],
        };
        const channel = version.includes('-') ? 'beta' : 'latest';
        const writeManifest = () => writeFile(path.join(directory, `${channel}.yml`), dump(manifest));
        await writeFile(path.join(directory, name), contents);
        await writeManifest();
        await expect(verifyRelease(directory, version, 'win', 'x64')).rejects.toThrow();
        await writeFile(path.join(directory, `${name}.blockmap`), 'blockmap');
        await expect(verifyRelease(directory, version, 'win', 'x64')).resolves.toBeUndefined();
        manifest.files[0].sha512 = 'incorrect';
        await writeManifest();
        await expect(verifyRelease(directory, version, 'win', 'x64')).rejects.toThrow('Checksum mismatch');
        manifest.files[0].url = '../outside.exe';
        await writeManifest();
        await expect(verifyRelease(directory, version, 'win', 'x64')).rejects.toThrow();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
