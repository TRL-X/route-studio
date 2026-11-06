# Development and verification

[Documentation](README.md) · [Project overview](../README.md)

Set up the shared Web and Electron editor and run its checks. Read [architecture](architecture.md) for module responsibilities and [contributing](../CONTRIBUTING.md) for pull requests and CI policy.

## Local development

Use Node.js 24 and npm:

```sh
npm ci
npm run dev
```

The editor opens with an empty route or a recovered draft. `npm run build` produces a static website in `dist/`; `npm run preview` serves that build locally. Vercel uses these same build settings and skips the Electron binary download.

### Desktop app

For the desktop app:

```sh
npx install-electron --no
npm run desktop:dev
```

React changes reload automatically. Restart after changing `electron/` files. The installed app bundles the editor and works offline for local editing and conversion; maps, terrain and magnetic lookup require internet access.

## Custom maps

`VITE_MAP_STYLE_URL` overrides OpenFreeMap. `VITE_MAP_DARK_STYLE_URL` optionally provides a dark variant. Restart or rebuild after changing either variable.

## Verification

```sh
npm run check
npx playwright install chromium
npm run test:e2e
npm run desktop:build
npm run desktop:typecheck
npm run test:desktop
```

`check` covers formatting, unit tests, type checks and production build. Browser tests cover editing, recovery and file conversion. Desktop tests use temporary profiles and simulated dialogs/Bluetooth; set `DESKTOP_EXECUTABLE` to test a packaged executable. Linux CI requires Chromium's OS dependencies and `xvfb-run --auto-servernum npm run test:desktop`. Desktop traces go to `desktop-test-results/`.

### Test locations

| Location                       | Coverage                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------ |
| `tests/domain/`                | Geometry, elevation, resampling, terrain comparison and magnetic declination.  |
| `tests/files/`, `tests/rte/`   | Project persistence, file conversion, format limits and RTE reference vectors. |
| `tests/services/`              | Magnetic lookup and terrain sampling/online tile clients.                      |
| `tests/device/`, `tests/maps/` | Device protocol/session behavior and basemap settings.                         |
| `tests/desktop/*.test.ts`      | Desktop security, update logic and release validation through Vitest.          |
| `tests/ci/*.test.mjs`          | CI selection, merge gates and macOS signature verification through Node tests. |
| `tests/e2e/*.spec.ts`          | Browser workflows through Playwright.                                          |
| `tests/desktop/*.spec.ts`      | Electron workflows through Playwright.                                         |

`npm test` runs Vitest and the CI policy/signature tests; it does not launch the Playwright suites. `npm run check` also leaves Electron type checking and both Playwright suites to the separate commands above.

### Troubleshooting

- If the Electron executable is missing, run `npx install-electron --no` before starting or testing the desktop app.
- If Chromium is missing, run `npx playwright install chromium`. On Linux, install Chromium OS dependencies as well; desktop tests need a display or `xvfb-run`.
- Restart desktop development after editing `electron/`; React changes reload automatically.
- If a browser or desktop test fails, inspect the retained trace in `test-results/` or `desktop-test-results/`.

Automated device tests simulate Bluetooth and firmware. Physical-device acceptance testing is required on each platform; see [device requirements](user-guide.md#bluetooth). Installed-app upgrade checks are described in [releasing](releasing.md#release-verification).
