import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import semver from 'semver';

export function previewVersion(base, run) {
  if (!semver.valid(base) || semver.prerelease(base))
    throw new Error('Preview base must be a stable version');
  if (!/^[1-9]\d*$/.test(String(run))) throw new Error('Invalid build sequence');
  const version = `${semver.inc(base, 'patch')}-beta.${run}`;
  if (!semver.valid(version)) throw new Error('Invalid preview version');
  return version;
}

export async function preparePreview(directory, { run, commit, builtAt }) {
  if (!/^[a-f0-9]{40}$/.test(commit ?? '') || !builtAt || !Number.isFinite(Date.parse(builtAt)))
    throw new Error('Invalid preview provenance');
  const packagePath = path.join(directory, 'package.json');
  const lockPath = path.join(directory, 'package-lock.json');
  const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  const version = previewVersion(pkg.version, run);
  pkg.version = version;
  pkg.buildInfo = { commit, builtAt: new Date(builtAt).toISOString() };
  lock.version = version;
  lock.packages[''].version = version;
  const notes = `Mainline preview ${version}\n\nBuild commit: ${commit}\nBuild time: ${pkg.buildInfo.builtAt}\n\nBuilt from main. Published only after all web and desktop checks pass.\n`;
  await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  await writeFile(path.join(directory, 'build', 'preview-release-notes.md'), notes);
  return version;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const version = await preparePreview(process.cwd(), {
    run: process.env.GITHUB_RUN_NUMBER,
    commit: process.env.GITHUB_SHA,
    builtAt: process.env.PREVIEW_BUILD_TIME,
  });
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `version=${version}\n`);
  console.log(`Prepared mainline preview ${version}`);
}
