import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { verifyMacApp } from '../../scripts/verify-macos-signatures.mjs';

test(
  'macOS verification rejects unsealed bundles and tampered signed resources',
  {
    skip: process.platform !== 'darwin',
  },
  () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'route-signature-test-'));
    const app = path.join(directory, 'Fixture.app');
    const contents = path.join(app, 'Contents');
    try {
      mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
      mkdirSync(path.join(contents, 'Resources'));
      copyFileSync('/usr/bin/true', path.join(contents, 'MacOS', 'Fixture'));
      const info = path.join(contents, 'Info.plist');
      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>Fixture</string>
<key>CFBundleIdentifier</key><string>org.trlx.signature-fixture</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>`;
      writeFileSync(info, plist);
      const resource = path.join(contents, 'Resources', 'payload.txt');
      writeFileSync(resource, 'original');
      assert.throws(() => verifyMacApp(app));

      execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', app]);
      assert.doesNotThrow(() => verifyMacApp(app));
      writeFileSync(resource, 'tampered');
      assert.throws(() => verifyMacApp(app));
      writeFileSync(resource, 'original');
      assert.doesNotThrow(() => verifyMacApp(app));
      writeFileSync(info, plist.replace('org.trlx.signature-fixture', 'org.trlx.changed'));
      assert.throws(() => verifyMacApp(app));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
