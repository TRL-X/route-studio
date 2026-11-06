import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertRequiredJobs, comparisonForEvent, requiresDesktopPackages } from '../../scripts/ci-policy.mjs';

test('renderer, web tests and documentation use Linux desktop validation', () => {
  assert.equal(
    requiresDesktopPackages([
      'src/app/Editor.tsx',
      'tests/e2e/editor.spec.ts',
      'tests/services/declination.test.ts',
      'README.md',
    ]),
    false,
  );
  assert.equal(requiresDesktopPackages([]), false);
});

test('native, dependency, build, shared helper and unknown changes require every platform', () => {
  for (const file of [
    'electron/main.cts',
    'package.json',
    'package-lock.json',
    '.nvmrc',
    '.npmrc',
    'electron-builder.yml',
    'vite.config.ts',
    'scripts/verify-release.mjs',
    '.github/workflows/check.yml',
    'build/icons/icon.icns',
    'tests/desktop/app.spec.ts',
    'tests/controls.ts',
    'src/desktop.d.ts',
    'src/app/DesktopBluetooth.tsx',
    'src/app/useUpdates.ts',
    'src/app/UpdatesPanel.tsx',
    'src/app/commands.ts',
    'src/features/editor/commands.ts',
    'src/features/device/DesktopBluetooth.tsx',
    'src/features/settings/useUpdates.ts',
    'src/features/settings/UpdatesPanel.tsx',
    'src/platform/files.ts',
    'src/platform/storage/draft.ts',
    'src/i18n/en.commands.desktop.json',
    'src/i18n/en.updates.json',
    'new-build-system/config.json',
  ]) {
    assert.equal(requiresDesktopPackages(['src/app/Editor.tsx', file]), true, file);
  }
});

const base = 'a'.repeat(40);
const head = 'b'.repeat(40);
test('PRs compare their own changes; queue groups compare the complete combined tree', () => {
  assert.equal(
    comparisonForEvent('pull_request', { pull_request: { base: { sha: base }, head: { sha: head } } }),
    `${base}...${head}`,
  );
  assert.equal(
    comparisonForEvent('merge_group', { merge_group: { base_sha: base, head_sha: head } }),
    `${base}..${head}`,
  );
  assert.equal(comparisonForEvent('push', {}), null);
  assert.equal(comparisonForEvent('workflow_dispatch', {}), null);
  assert.throws(() => comparisonForEvent('pull_request', {}));
  assert.throws(() =>
    comparisonForEvent('merge_group', { merge_group: { base_sha: '--help', head_sha: head } }),
  );
});

function results(full) {
  return {
    changes: { result: 'success', outputs: { full_desktop: String(full) } },
    web: { result: 'success' },
    'desktop-smoke': { result: full ? 'skipped' : 'success' },
    'desktop-packages': { result: full ? 'success' : 'skipped' },
  };
}

test('the merge gate accepts only a successful selected desktop path and Web checks', () => {
  for (const full of [true, false]) {
    assert.doesNotThrow(() => assertRequiredJobs(results(full)));
    for (const job of ['changes', 'web', full ? 'desktop-packages' : 'desktop-smoke']) {
      for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
        const needs = results(full);
        needs[job].result = result;
        assert.throws(() => assertRequiredJobs(needs), undefined, `${full}: ${job} ${result}`);
      }
    }
  }
  assert.throws(() => assertRequiredJobs({}));
  const needs = results(false);
  needs.changes.outputs.full_desktop = '';
  assert.throws(() => assertRequiredJobs(needs));
});

test('deleted or renamed native files cannot disappear from change detection', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'route-studio-ci-'));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  try {
    git('init', '-q');
    git('config', 'user.email', 'ci@example.invalid');
    git('config', 'user.name', 'CI policy test');
    writeFileSync(path.join(cwd, 'package.json'), '{}\n');
    git('add', '.');
    git('commit', '-qm', 'base');
    const baseSha = git('rev-parse', 'HEAD');
    git('mv', 'package.json', 'README.md');
    git('commit', '-qam', 'rename');
    const headSha = git('rev-parse', 'HEAD');
    const eventPath = path.join(cwd, 'event.json');
    const outputPath = path.join(cwd, 'output');
    for (const [eventName, event] of [
      ['pull_request', { pull_request: { base: { sha: baseSha }, head: { sha: headSha } } }],
      ['merge_group', { merge_group: { base_sha: baseSha, head_sha: headSha } }],
    ]) {
      writeFileSync(eventPath, JSON.stringify(event));
      writeFileSync(outputPath, '');
      execFileSync(
        process.execPath,
        [fileURLToPath(new URL('../../scripts/ci-policy.mjs', import.meta.url)), 'changes'],
        {
          cwd,
          env: {
            ...process.env,
            GITHUB_EVENT_NAME: eventName,
            GITHUB_EVENT_PATH: eventPath,
            GITHUB_OUTPUT: outputPath,
          },
        },
      );
      assert.equal(readFileSync(outputPath, 'utf8'), 'full_desktop=true\n');
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
