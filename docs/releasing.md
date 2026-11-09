# Desktop packaging and releases

[Documentation](README.md) / [Project overview](../README.md)

Build desktop installers, configure signing, and publish compatible update artifacts. Complete [development setup](development.md#local-development) first. End-user update steps are in the [user guide](user-guide.md#software-updates).

## Desktop packaging

```sh
npm run desktop:pack                       # Current platform
npm run desktop:pack -- --mac --arm64       # macOS Apple Silicon
npm run desktop:pack -- --mac --x64         # macOS Intel
npm run desktop:pack -- --win --x64         # Windows NSIS
npm run desktop:pack -- --linux --x64       # Linux AppImage and Debian
```

Outputs go to `release/`; `desktop:pack:dir` creates an unpacked app. `node scripts/generate-icons.mjs` regenerates icons from `src/assets/logo.svg` using electron-builder's icon tools.

## Signing and CI builds

The **Check editor** workflow calls **Desktop packages** for native builds when desktop validation is required (see [CI validation](../CONTRIBUTING.md#ci-validation)). Full builds produce installer artifacts; version tags create a GitHub Release draft after all checks pass. Stable publishing remains a maintainer action; pushes to `main` automatically publish verified previews as described below. Release tags and mainline previews use the same signing secrets:

| Platform           | Secrets                                                             |
| ------------------ | ------------------------------------------------------------------- |
| macOS signing      | `MAC_CSC_LINK` (base64 P12), `MAC_CSC_KEY_PASSWORD`                 |
| macOS notarization | `APPLE_API_KEY` (base64 P8), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` |
| Windows signing    | `WIN_CSC_LINK` (base64 PFX), `WIN_CSC_KEY_PASSWORD`                 |

Without certificates, CI signs macOS apps ad hoc before creating the DMG and ZIP; Windows packages remain unsigned. The ad-hoc entitlements retain hardened runtime and allow Electron's libraries to load without a Team ID. Certificate-backed macOS builds retain the regular entitlements and notarization flow. Ad-hoc signing provides bundle integrity, not a verified developer identity or notarization, so downloaded apps may still need approval in **System Settings → Privacy & Security**. File associations are not enabled. Keep application ID `org.trlx.route-studio` unchanged to preserve profiles.

To build the same ad-hoc macOS packages locally (replace `--arm64` with `--x64` for Intel):

```sh
CSC_IDENTITY_AUTO_DISCOVERY=false npm run desktop:pack -- --mac --arm64 \
  -c.mac.identity=- -c.mac.notarize=false \
  -c.mac.entitlements=build/entitlements.mac.adhoc.plist \
  -c.mac.entitlementsInherit=build/entitlements.mac.adhoc.plist
node scripts/verify-macos-signatures.mjs release arm64
```

On both macOS CI runners, signature verification runs `codesign --verify --deep --strict` against the unpacked app and copies extracted from the ZIP and read-only DMG before uploading artifacts. This accepts valid ad-hoc and Developer ID signatures and rejects missing or damaged signatures. Gatekeeper trust and notarization are separate checks. Published releases are immutable; distribute a corrected installer under a new patch version.

## Update artifacts

The update source is the public `TRL-X/route-studio` GitHub repository. Keep `electron-builder.yml` and `electron/update-release.ts` in sync if moving releases. Windows and Linux packages include `electron-updater` and `app-update.yml`; publish their `latest*.yml` (stable) or `beta*.yml` (preview), installers and generated `.blockmap` files together. macOS intentionally sets `publish: null` in the builder and uses GitHub release assets instead of `latest-mac.yml`, avoiding dual-architecture manifest collisions. CI uses `--publish never`, collects all outputs, validates manifest versions, sizes and SHA-512 hashes, then uploads to a **draft** release. Only expose the release after all four platform/architecture builds pass. Never replace artifacts in an already-published version; issue a new version for a fix.

## Mainline previews

Every push to `main` builds a preview in the existing four-platform matrix. `scripts/prepare-preview.mjs` derives `<next-patch>-beta.<workflow-run-number>` from the stable version in `package.json`, for example `0.1.3` → `0.1.4-beta.123`. It stamps the CI checkout's package and lockfile, embeds the commit and shared build time in `package.json`, and writes `build/preview-release-notes.md`. These generated changes are not committed. Retries of the same workflow use the same version, including retries of only failed jobs. New workflow runs have distinct versions. Keep the package version on main aligned with stable releases; prerelease bases are rejected.

The packager explicitly selects the `beta` publish channel and embeds the preview notes in the update manifests. After `verify` succeeds, the `preview-release` job repeats the same version preparation, verifies the complete artifact set, creates a prerelease draft targeting the exact built SHA, uploads everything, then publishes it with `latest=false`. It skips a run whose commit is no longer the head of main. PR, merge queue and manual validation runs do not publish previews. Published releases cannot be overwritten by retries; only draft uploads may be replaced.

The stable feed remains isolated from previews. Clients opt in through **Settings → Software update → Update channel**; Windows/AppImage use application updates, while macOS/DEB offer the matching manual installer. Preview checks compare semantic versions from the recent release list plus the latest stable release. Windows/AppImage then pin `electron-updater` to that release's verified GitHub asset directory and channel manifest, so a later-published stable version cannot hide a newer preview. To introduce this feature to installed stable-only clients, first publish a new stable version containing the channel selector. Switching back to stable never enables automatic downgrades. See the [user guide](user-guide.md#software-updates) for the manual return path.

## Release verification

`node scripts/verify-release.mjs release win x64` validates one build; omit the platform and architecture to validate the complete release directory. Update tests use simulated downloads/installers and isolated profiles; `--disable-updates` prevents real checks in desktop tests. Before distributing the first updater release, verify a real installed N → N+1 upgrade on Windows and a writable Linux AppImage, plus manual replacement on both Mac architectures. This also checks OS-specific installer behavior that simulation cannot cover.

The Windows package job runs [test-windows-associations.ps1](../scripts/test-windows-associations.ps1) only on a disposable CI runner. It installs, reinstalls and uninstalls the actual NSIS package, checks the four quoted open commands and the REG_NONE default-takeover flag, and verifies that extension defaults, UserChoice and another application's Open With entry survive. Desktop tests cover cold starts, second-process forwarding, recovery protection, pending requests and multi-file selection.

Before release, also check the actual file-manager menus on Windows 11, macOS and Linux: GPX/KML/FIT/RTE should offer Route Studio, and files with an existing default should still double-click into that application after installation and upgrades. Check Windows' **Show more options** menu, Finder's **Open With**, DEB desktop/MIME installation and an integrated AppImage. Systems without a chosen default can select a handler as a fallback; the app does not set one. Verify removal clears the application's entries without restoring a historical default.
