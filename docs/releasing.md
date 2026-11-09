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

The **Check editor** workflow calls **Desktop packages** for native builds when desktop validation is required (see [CI validation](../CONTRIBUTING.md#ci-validation)). Full builds produce installer artifacts; version tags create a GitHub Release draft after all checks pass. Publishing remains a maintainer action. Signing secrets:

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

The update source is the public `TRL-X/route-studio` GitHub repository. Keep `electron-builder.yml` and `electron/update-release.ts` in sync if moving releases. Windows and Linux packages include `electron-updater` and `app-update.yml`; publish their `latest*.yml`, installers and generated `.blockmap` files together. macOS intentionally sets `publish: null` in the builder and uses GitHub release assets instead of `latest-mac.yml`, avoiding dual-architecture manifest collisions. The existing CI still uses `--publish never`, collects all outputs, validates manifest versions, sizes and SHA-512 hashes, then uploads to a **draft** release. Maintainers publish only after all four platform/architecture builds pass. Never replace artifacts in an already-published version; issue a higher patch version for a fix.

## Release verification

`node scripts/verify-release.mjs release win x64` validates one build; omit the platform and architecture to validate the complete release directory. Update tests use simulated downloads/installers and isolated profiles; `--disable-updates` prevents real checks in desktop tests. Before distributing the first updater release, verify a real installed N → N+1 upgrade on Windows and a writable Linux AppImage, plus manual replacement on both Mac architectures. This also checks OS-specific installer behavior that simulation cannot cover.

The Windows package job runs [test-windows-associations.ps1](../scripts/test-windows-associations.ps1) only on a disposable CI runner. It installs, reinstalls and uninstalls the actual NSIS package, checks the four quoted open commands and the REG_NONE default-takeover flag, and verifies that extension defaults, UserChoice and another application's Open With entry survive. Desktop tests cover cold starts, second-process forwarding, recovery protection, pending requests and multi-file selection.

Before release, also check the actual file-manager menus on Windows 11, macOS and Linux: GPX/KML/FIT/RTE should offer Route Studio, and files with an existing default should still double-click into that application after installation and upgrades. Check Windows' **Show more options** menu, Finder's **Open With**, DEB desktop/MIME installation and an integrated AppImage. Systems without a chosen default can select a handler as a fallback; the app does not set one. Verify removal clears the application's entries without restoring a historical default.
