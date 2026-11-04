# Route Studio

A route editor for TRL-X devices, available on the web and as an Electron desktop app. Import FIT, GPX, KML or RTE, edit geometry, stations and elevations, then export RTE, GPX, KML or FIT. The interface supports English and Simplified Chinese.

## Development

Use Node.js 24 and npm:

```sh
npm ci
npm run dev
```

The editor opens with an empty route or a recovered draft. `npm run build` produces a static website in `dist/`; `npm run preview` serves that build locally. Vercel uses these same build settings and skips the Electron binary download.

For the desktop app:

```sh
npx install-electron --no
npm run desktop:dev
```

React changes reload automatically. Restart after changing `electron/` files. The installed app bundles the editor and works offline for local editing and conversion; maps, terrain and magnetic lookup require internet access.

## Editing routes

1. Open a file through **Menu → File**, drop a file, or choose **Menu → File → New route**. For files containing multiple tracks or sessions, select a route to edit.
2. Append, insert or drag route points. Add stations on the route, choosing the intended pass when a route visits the same location more than once. A station's route distance and landmark coordinates can be edited independently.
3. Imports with missing elevations prompt you to fill short gaps or preview a full online replacement. Gaps up to 1,000 m can be interpolated from existing heights; longer gaps or a missing profile need terrain data. Choose **Later** to keep editing, then return via **Elevation tools…** in the profile or **Menu → Route**. Online requests start only when you choose the online preview; review it before **Replace all elevations**. Both edits can be undone.
4. Save a `.routeproj` to preserve unfinished edits, missing heights, station settings and magnetic data. Recovery drafts are saved locally; use project files for backups and transfer between computers.
5. Open **Export…**, select RTE, GPX, KML or FIT, then resolve blocking issues and review the output before downloading. RTE processing defaults to 10 m elevation spacing, 2 m geometry tolerance and 10 m smoothing; these settings affect the export, not the project.

The interface uses Radix Themes with system fonts, neutral surfaces and a blue accent. **Settings… → General** controls language and appearance; appearance follows the system by default. The inspector groups related properties, and narrow windows provide **Route outline** and **Edit selection** panels. Drag the profile divider, or focus it and use arrow keys, to resize the chart.

Numeric fields support **Enter** to commit, **Escape** to cancel and **↑ / ↓** to step. The station list supports **↑ / ↓** and **Home / End**. Menus and dialogs support keyboard navigation and return focus when closed.

| Shortcut             | Action                                   |
| -------------------- | ---------------------------------------- |
| `Ctrl/⌘ + O`         | Open                                     |
| `Ctrl/⌘ + S`         | Save project                             |
| `Ctrl/⌘ + Z`         | Undo                                     |
| `Ctrl/⌘ + Shift + Z` | Redo                                     |
| `Ctrl/⌘ + ,`         | Settings                                 |
| `Esc`                | Close a menu or dialog; cancel placement |

### Format support

FIT Course and GPS Activity sessions are supported. Enhanced altitude takes precedence over standard altitude; missing heights remain editable. Training measurements are not retained, and distances are calculated from geometry. Station matching uses recorded timestamps and distances where available to distinguish repeated visits.

GPX waypoints become checkpoints; KML points are matched to nearby routes and otherwise remain unassigned. Endpoint markers can supply start/finish names. KML heights without a declared altitude mode require confirmation on import.

| Export     | Contents and limits                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| RTE        | Device route, stations, elevation and optional magnetic declination. Processing preserves endpoints and stage boundaries.                        |
| GPX 1.1    | Track vertices, elevation samples and named station waypoints. Waypoints cannot distinguish repeated visits.                                     |
| KML 2.2    | Route line and named station points. Absolute altitude requires a complete mean-sea-level profile; otherwise the preview explains the 2D export. |
| FIT Course | Distance, available heights and anchored course points linked to the intended visit. Synthetic timestamps order records one second apart.        |

Previews report stations that cannot be exported. Keep the project file to preserve all editor-specific information.

RTE support targets the **November 1, 2026 draft of TRL-X Route 1.0**: [pinned specification and reference vectors](https://github.com/TRL-X/route-specification/tree/6918eb7aa438186589a516f8caccb03b960c6c0e). Unknown noncritical sections and META extension keys are dropped; unknown critical sections are rejected. Reader limits are 64 MiB, 256 sections, one million GEOM/ELEV/GIDX records each, and 8 MiB / 24 nesting levels / 250,000 items for META. Devices may impose lower limits.

### Online services and device upload

- **Maps:** OpenFreeMap is the default. **Settings… → Map** also supports Tianditu with your own [Key](https://console.tianditu.gov.cn/), or an offline coordinate grid. Apply saves changes; Cancel discards them. Provider, visibility and Key are stored locally, separate from projects. The Key is readable in storage and requests; **Clear Key** removes it after applying. Electron requests originate from `app://route-studio/`, so check Key restrictions in the packaged app. Failures preserve settings and offer Retry.
- **Custom maps:** `VITE_MAP_STYLE_URL` overrides OpenFreeMap. `VITE_MAP_DARK_STYLE_URL` optionally provides a dark variant. Restart or rebuild after changing either variable.
- **Terrain:** The [Planetary Computer GLO-30 collection](https://planetarycomputer.microsoft.com/dataset/cop-dem-glo-30) supplies EGM2008 surface heights. Tile requests reveal the route's area. Nearest-grid sampling may include treetops or terrain above tunnels; review before replacement. [Copernicus attribution](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM).
- **Magnetic declination:** Edit this in the inspector through **Menu → Route → Route properties**. Automatic lookup sends the route's distance midpoint and selected UTC date to BGS WMM2025. Results are saved in the project for offline use. Retry, enter a manual value (east positive), or omit declination if unavailable. Imported RTE magnetic metadata stays unchanged until edited.
- **Bluetooth:** From the RTE preview, choose **Bluetooth upload…**, enter a new full destination such as `/SD:/ROUTES/TEST.RTE`, then select the device. The directory must exist. Length and IEEE CRC32 are verified; an existing different file requires another filename. Interrupted uploads may leave partial files. Web use requires HTTPS or localhost and Web Bluetooth support; desktop use requires OS permission and a working adapter. Physical-device acceptance testing is still required on each platform.

## Desktop packaging

```sh
npm run desktop:pack                       # Current platform
npm run desktop:pack -- --mac --arm64       # macOS Apple Silicon
npm run desktop:pack -- --mac --x64         # macOS Intel
npm run desktop:pack -- --win --x64         # Windows NSIS
npm run desktop:pack -- --linux --x64       # Linux AppImage and Debian
```

Outputs go to `release/`; `desktop:pack:dir` creates an unpacked app. `node scripts/generate-icons.mjs` regenerates icons from `src/assets/logo.svg` using electron-builder's icon tools.

Native open/save dialogs limit files to 64 MiB. Cancelling a save preserves edits. Closing warns about changes not saved as a project; exporting a route does not mark the project saved. Desktop drafts use a separate Electron profile. Drag empty toolbar space to move the window; Windows/Linux reveal the application menu with **Alt**.

The renderer uses context isolation, sandboxing, disabled Node integration and a restricted `app://route-studio/` protocol with CSP. Only the main frame can use the file bridge, and it cannot supply filesystem paths. HTTP/HTTPS links open in the system browser.

The **Desktop packages** workflow builds and tests packages on native runners. Pull requests and manual runs produce artifacts; version tags create a GitHub Release draft. Publishing remains a maintainer action. Signing secrets:

| Platform           | Secrets                                                             |
| ------------------ | ------------------------------------------------------------------- |
| macOS signing      | `MAC_CSC_LINK` (base64 P12), `MAC_CSC_KEY_PASSWORD`                 |
| macOS notarization | `APPLE_API_KEY` (base64 P8), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` |
| Windows signing    | `WIN_CSC_LINK` (base64 PFX), `WIN_CSC_KEY_PASSWORD`                 |

Without certificates, packages are unsigned. Check signing/notarization before distribution. File associations are not enabled. Keep application ID `org.trlx.route-studio` unchanged to preserve profiles.

### Software updates

Desktop **Settings… → Software update** shows the current version, release notes and update progress. **Check for updates…** is also available in the application menu. Automatic checks start 15 seconds after launch and run at most once per 24 hours, including failed attempts; the preference is saved immediately in the desktop profile. Manual checks bypass this interval. Background checks never open a modal or start a download. Available updates appear in the status bar.

- **macOS:** unsigned builds check public GitHub Releases and open the matching Intel or Apple Silicon DMG in the browser (including Apple Silicon when running under Rosetta). Save the project, quit the app and replace it in Applications. No automatic installer is loaded on macOS.
- **Windows NSIS / Linux AppImage:** explicitly download the update, then choose **Restart and install**. Downloaded updates are not installed on ordinary quit. Unsaved projects require saving successfully or explicitly discarding changes. Saving, importing, exporting and Bluetooth selection/transfers block installation. AppImage installation requires write access to the file and its directory.
- **Linux DEB:** check for updates and download the matching package for manual installation. Development builds have updates disabled.

Only stable releases newer than the installed version are accepted; drafts, prereleases and downgrades are excluded. Update failures leave the editor usable and downloads can be retried. Update notes are displayed as text. No release token is shipped to clients. Projects, recovery drafts and preferences stay in their existing locations. Users of versions without this feature must install an update-capable version manually once.

The update source is the public `TRL-X/route-studio` GitHub repository. Keep `electron-builder.yml` and `electron/update-release.ts` in sync if moving releases. Windows and Linux packages include `electron-updater` and `app-update.yml`; publish their `latest*.yml`, installers and generated `.blockmap` files together. macOS intentionally sets `publish: null` in the builder and uses GitHub release assets instead of `latest-mac.yml`, avoiding dual-architecture manifest collisions. The existing CI still uses `--publish never`, collects all outputs, validates manifest versions, sizes and SHA-512 hashes, then uploads to a **draft** release. Maintainers publish only after all four platform/architecture builds pass. Never replace artifacts in an already-published version; issue a higher patch version for a fix.

`node scripts/verify-release.mjs release win x64` validates one build; omit the platform and architecture to validate the complete release directory. Update tests use simulated downloads/installers and isolated profiles; `--disable-updates` prevents real checks in desktop tests. Before distributing the first updater release, verify a real installed N → N+1 upgrade on Windows and a writable Linux AppImage, plus manual replacement on both Mac architectures. This also checks OS-specific installer behavior that simulation cannot cover.

## Contributing and verification

Use short-lived branches and pull requests targeting `main`. Resolve reviews and pass **Check editor / verify** before a [mergers team](https://github.com/orgs/TRL-X/teams/route-studio-mergers) member squash-merges. Write code, comments and documentation in English; translations belong in `src/i18n/`.

```sh
npm run check
npx playwright install chromium
npm run test:e2e
npm run desktop:build
npm run desktop:typecheck
npm run test:desktop
```

`check` covers formatting, unit tests, type checks and production build. Browser tests cover editing, recovery and file conversion. Desktop tests use temporary profiles and simulated dialogs/Bluetooth; set `DESKTOP_EXECUTABLE` to test a packaged executable. Linux CI requires Chromium's OS dependencies and `xvfb-run --auto-servernum npm run test:desktop`. Desktop traces go to `desktop-test-results/`.
