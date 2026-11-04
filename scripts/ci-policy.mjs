import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export function requiresDesktopPackages(paths) {
  return paths.some((path) => {
    // Native integrations and update UI still need the complete platform matrix.
    if (/^src\/.*(desktop|updates)/i.test(path) || path === 'src/app/commands.ts') return true;
    // Unknown paths default to full validation, including dependencies, build assets,
    // configuration, shared test helpers, Electron, scripts and workflows.
    return !/^(src\/|tests\/(domain|device|files|maps|rte|e2e|fixtures)\/|docs\/|README\.md$)/.test(path);
  });
}

export function comparisonForEvent(eventName, event) {
  let base;
  let head;
  let separator;
  if (eventName === 'pull_request') {
    base = event.pull_request?.base?.sha;
    head = event.pull_request?.head?.sha;
    separator = '...';
  } else if (eventName === 'merge_group') {
    base = event.merge_group?.base_sha;
    head = event.merge_group?.head_sha;
    separator = '..';
  } else {
    // main, release tags and manual runs always validate every platform.
    return null;
  }
  if (![base, head].every((sha) => typeof sha === 'string' && /^[a-f0-9]{40}$/.test(sha))) {
    throw new Error(`Missing or invalid comparison commits for ${eventName}`);
  }
  return `${base}${separator}${head}`;
}

export function assertRequiredJobs(needs) {
  const full = needs.changes?.outputs?.full_desktop;
  if (full !== 'true' && full !== 'false') throw new Error('Missing desktop validation decision');
  const expected = {
    changes: 'success',
    web: 'success',
    'desktop-smoke': full === 'true' ? 'skipped' : 'success',
    'desktop-packages': full === 'true' ? 'success' : 'skipped',
  };
  for (const [job, result] of Object.entries(expected)) {
    if (needs[job]?.result !== result) {
      throw new Error(`${job}: expected ${result}, got ${needs[job]?.result ?? 'missing'}`);
    }
  }
}

if (import.meta.main) {
  if (process.argv[2] === 'changes') {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const comparison = comparisonForEvent(process.env.GITHUB_EVENT_NAME, event);
    const paths = comparison
      ? execFileSync('git', ['diff', '--no-renames', '--name-only', '-z', comparison, '--'], {
          encoding: 'utf8',
        })
          .split('\0')
          .filter(Boolean)
      : [];
    const full = comparison === null || requiresDesktopPackages(paths);
    appendFileSync(process.env.GITHUB_OUTPUT, `full_desktop=${full}\n`);
    console.log(`Desktop validation: ${full ? 'all platforms and installers' : 'Linux unpacked app'}`);
  } else if (process.argv[2] === 'verify') {
    assertRequiredJobs(JSON.parse(process.env.CI_JOB_RESULTS));
    console.log('All required checks passed.');
  } else {
    throw new Error('Usage: node scripts/ci-policy.mjs changes|verify');
  }
}
