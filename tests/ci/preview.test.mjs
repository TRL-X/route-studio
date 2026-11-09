import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import semver from 'semver';
import { preparePreview, previewVersion } from '../../scripts/prepare-preview.mjs';

test('preview versions upgrade from stable, order runs, then yield to the next stable', () => {
  const first = previewVersion('0.1.3', '9');
  const next = previewVersion('0.1.3', '10');
  for (const [older, newer] of [
    ['0.1.3', first],
    [first, next],
    [next, '0.1.4'],
  ]) {
    assert.equal(semver.lt(older, newer), true, `${older} < ${newer}`);
  }
  assert.equal(previewVersion('1.2.99', '123'), '1.2.100-beta.123');
  for (const args of [
    ['0.1.3-beta.1', '1', '1'],
    ['bad', '1', '1'],
    ['0.1.3', '01', '1'],
    ['0.1.3', undefined],
  ]) {
    assert.throws(() => previewVersion(...args));
  }
});

test('every platform and the publisher derive identical versions, metadata and notes from one build identity', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'route-preview-'));
  try {
    const build = { run: '123', commit: 'a'.repeat(40), builtAt: '2026-11-09T08:00:00Z' };
    await mkdir(path.join(directory, 'build'));
    for (let job = 0; job < 5; job++) {
      await writeFile(path.join(directory, 'package.json'), JSON.stringify({ version: '0.1.3' }));
      await writeFile(
        path.join(directory, 'package-lock.json'),
        JSON.stringify({ version: '0.1.3', packages: { '': { version: '0.1.3' } } }),
      );
      assert.equal(await preparePreview(directory, build), '0.1.4-beta.123');
      const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
      const lock = JSON.parse(await readFile(path.join(directory, 'package-lock.json'), 'utf8'));
      assert.equal(pkg.version, lock.version);
      assert.equal(pkg.version, lock.packages[''].version);
      assert.deepEqual(pkg.buildInfo, { commit: build.commit, builtAt: '2026-11-09T08:00:00.000Z' });
      const notes = await readFile(path.join(directory, 'build', 'preview-release-notes.md'), 'utf8');
      assert.ok(
        notes.includes(`Build commit: ${pkg.buildInfo.commit}\nBuild time: ${pkg.buildInfo.builtAt}`),
      );
    }
    await assert.rejects(preparePreview(directory, { ...build, commit: 'main' }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
