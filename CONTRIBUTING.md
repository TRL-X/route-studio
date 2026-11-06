# Contributing

[Project overview](README.md) · [Documentation](docs/README.md)

For local setup and verification commands, see [development](docs/development.md). For module responsibilities, see [architecture](docs/architecture.md).

## Pull requests

Use short-lived branches and pull requests targeting `main`. Resolve reviews and pass **Check editor / verify**, then add the PR to the merge queue. The queue validates the combined changes against the latest `main` and squash-merges automatically; updating every PR branch after another PR merges is unnecessary unless there is a conflict. Write code, comments and documentation in English; translations belong in `src/i18n/`.

## CI validation

CI runs once per PR revision and again for each merge group. A newer PR revision cancels the previous run. Web checks and desktop validation run in parallel, and the stable `verify` check requires both to pass:

- All PRs run formatting, all unit tests, Web/Electron type checks, a production build and all browser tests. Browser tests reuse the build in CI; local `test:e2e` still builds automatically.
- Renderer, Web-test, `README.md` and `docs/` changes run the complete desktop test suite against a Linux unpacked application, without generating installers.
- Electron, updater/native integration (including `src/platform/` and shared editor commands), dependency, build, shared test helper, CI and other unclassified changes require all four native package/test jobs: macOS ARM64 and x64, Windows x64 and Linux x64. `scripts/ci-policy.mjs` defines the selection. Renames and deletions are included; merge groups inspect all combined changes.
- Pushes to `main`, `v*` tags and manual **Check editor** runs always build and test all four packages. Newer `main` runs cancel older ones; release and merge-group runs are not cancelled by that policy.

Root-level documentation such as `CONTRIBUTING.md` currently follows the unclassified-path rule and requires all four native package/test jobs.

## Merge queue

Only `verify` is required in branch rules. It rejects failed, cancelled or unexpectedly skipped dependencies, including the selected desktop checks. Keep `pull_request` and `merge_group` triggers enabled; filtering out the entire workflow can leave the required check pending.

The [GitHub Flow ruleset](https://github.com/TRL-X/route-studio/rules/26424914) requires the merge queue, with up to three groups validating concurrently, all entries required to pass, and a 30-minute check timeout. One ready PR is enough to merge, so the queue does not wait to accumulate a batch. After `verify` passes, use **Merge when ready** / **Add to merge queue** in GitHub, or `gh pr merge <number> --repo TRL-X/route-studio`. The queue runs `verify` again on the combined changes and squash-merges automatically. If a queue check fails, inspect the failed job, fix the PR or rerun a transient failure, then re-add the PR to the queue.

## Documentation changes

Keep the README as the project entry point and use the [documentation index](docs/README.md) to find the guide that owns a topic. Update behavior and its documentation together. Maintain each rule in one guide and link to it from related guides. Architecture documentation describes the current implementation; proposed directory layouts belong in a separate proposal until implemented.

Use repository-relative links so navigation works in both a checkout and GitHub. When moving a section, update links to its heading and check that source-file links still resolve. Run the formatter and check links for documentation changes; follow the CI validation policy above for the required merge checks.
