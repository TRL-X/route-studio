# User guide

[Documentation](README.md) / [Project overview](../README.md)

Edit routes, preserve work in project files, and send routes to a TRL-X device. See [format support](formats.md) for import and export limits.

## Editing routes

1. Open a file through **Menu → File**, drop a file, or choose **Menu → File → New route**. For files containing multiple tracks or sessions, select a route to edit.
2. Use the editing tools or **Menu → Edit** to append, insert or drag route points. Add stations on the route, choosing the intended pass when a route visits the same location more than once. A station's route distance and landmark coordinates can be edited independently.
3. Imports with missing elevations prompt you to fill short gaps or preview a full online replacement. Gaps up to 1,000 m can be interpolated from existing heights; longer gaps or a missing profile need terrain data. Choose **Later** to keep editing, then return via **Elevation tools…** in the profile or **Menu → Route**. Online requests start only when you choose the online preview; review it before **Replace all elevations**. Both edits can be undone.
4. Save a `.routeproj` to preserve unfinished edits, missing heights, station settings and magnetic data. Recovery drafts are saved locally. If the editor has no record of a saved project copy for a recovered draft, it asks before replacing the draft with a new or opened route. In the desktop app, you can save the project and continue in one step. In a browser, check that the project download finished before choosing **Continue**.
5. Open **Export…**, select RTE, GPX, KML or FIT, then resolve blocking issues and review the output before downloading. RTE processing defaults to 10 m elevation spacing, 2 m geometry tolerance and 10 m smoothing; these settings affect the export, not the project.

The toolbar keeps **Menu**, **Undo**, **Redo**, the route name, **Save project** and **Export…** close to the editor. **Menu** groups file operations, editing, route tools and view options, followed by **Device** and **Settings…**. The **View** menu shows whether the elevation profile is visible. Device actions are available through the **Device** submenu.

## Resampling

Use **Menu → Route → Resample route points…** after drawing or editing a route to redistribute its geometry points. Defaults are 2–20 m spacing and at most 0.5 m shape deviation. The preview overlays the original and resampled routes, reports point counts, length changes and actual spacing, and locates short segments retained for stations, turns or endpoints. Minimum spacing is a target; preserving these features takes priority. Station details and existing elevation samples (including missing heights) are retained. Parameter changes always start from the original route; **Apply resampling** changes the project in one undoable edit. Calculations can be cancelled and are limited to 100,000 output points plus a bounded processing budget.

## Appearance and layout

The interface uses Radix Themes with system fonts, neutral surfaces and a blue accent. **Menu → Settings… → General** controls language and appearance; appearance follows the system by default. The inspector groups related properties, and narrow windows provide **Route outline** and **Edit selection** panels. Drag the profile divider, or focus it and use arrow keys, to resize the chart.

## Keyboard controls

Numeric fields support **Enter** to commit, **Escape** to cancel and **↑ / ↓** to step. The station list supports **↑ / ↓** and **Home / End**. Menus and dialogs support keyboard navigation and return focus when closed.

| Shortcut             | Action                                   |
| -------------------- | ---------------------------------------- |
| `Ctrl/⌘ + O`         | Open                                     |
| `Ctrl/⌘ + S`         | Save project                             |
| `Ctrl/⌘ + Z`         | Undo                                     |
| `Ctrl/⌘ + Shift + Z` | Redo                                     |
| `Ctrl/⌘ + ,`         | Settings                                 |
| `Esc`                | Close a menu or dialog; cancel placement |

## Online services and device upload

### Maps

OpenFreeMap is the default. **Settings… → Map** also supports Tianditu with your own [Key](https://console.tianditu.gov.cn/), or an offline coordinate grid. Apply saves changes; Cancel discards them. Provider, visibility and Key are stored locally, separate from projects. The Key is readable in storage and requests; **Clear Key** removes it after applying. Electron requests originate from `app://route-studio/`, so check Key restrictions in the packaged app. Failures preserve settings and offer Retry.

For build-time map style overrides, see [custom maps](development.md#custom-maps).

### Terrain

The [Planetary Computer GLO-30 collection](https://planetarycomputer.microsoft.com/dataset/cop-dem-glo-30) supplies EGM2008 surface heights. Tile requests reveal the route's area. Nearest-grid sampling may include treetops or terrain above tunnels; review before replacement. [Copernicus attribution](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM).

### Magnetic declination

Edit this in the inspector through **Menu → Route → Route properties**. Automatic lookup sends the route's distance midpoint and selected UTC date to BGS WMM2025. Results are saved in the project for offline use. Retry, enter a manual value (east positive), or omit declination if unavailable. Imported RTE magnetic metadata stays unchanged until edited.

### Device connections

Open **Menu → Device → Device connection…** and choose **Bluetooth** or **USB** to connect, disconnect or choose another device. The connection is shared by route sending, device route management and normal firmware updates. Closing a panel keeps the connection available for the next task. After leaving USB recovery, opening a normal connection or route action returns to the previous normal transport when no recovery operation is active or paused.

Choose **Menu → Device → Send current route…** to review the current route in RTE format, adjust processing options and resolve validation issues. Choose **Connect and send…**, or **Send to [device name]** when connected. Pairing is followed by sending automatically. This preview uses the same conversion and validation as file export; **Export…** only saves files. Route Studio waits for device validation and catalog publication before reporting success. Names come from RTE metadata; no device path is required.

Choose **Menu → Device → Manage device routes…** to inspect capacity, refresh the route list and delete unused routes. **View device routes** and **Manage device routes** in a send result open this same panel.

Active or interrupted transfers appear in the bottom status bar; select the task to reopen it. **Hide** closes a busy task panel without cancelling it. After a disconnection, choose **Reconnect and continue**; the original route data and processing settings are retained while the app stays open. Processing settings stay locked until the transfer finishes or is cancelled. Uploads can be cancelled before validation starts. Device restart or transaction expiry may require a fresh upload; refreshing or closing the app loses the local recovery state. Idle connections do not add controls to the toolbar or status bar.

If a paused route transfer cannot be resumed or cancelled, **End task…** asks for confirmation before stopping local tracking and releasing the connection for another task, including USB recovery. This does not cancel processing on the device or delete data already written there. **Keep task** returns to the transfer. Check the device route list after reconnecting to determine its final state.

USB normal mode requires an SMP server in the running application, with the same route, filesystem, image and OS commands as Bluetooth. MCUboot recovery alone does not provide route management. Web use requires HTTPS or localhost and Web Bluetooth or Web Serial support; desktop use requires the corresponding OS permissions and hardware. Physical-device acceptance testing is still required on each platform.

### Firmware updates and recovery

Open **Menu → Device → Update device firmware…** for a normal Bluetooth or USB update, or **Menu → Device → USB recovery…** for serial recovery. Each entry opens its own workflow directly. Select a local MCUboot `.bin` file intended for the connected device. Route Studio checks its structure and SHA-256 digest and displays the version and size; the bootloader is responsible for checking its signature and accepting the image. The default local file limit is 64 MiB and can be changed in the connection profile. HEX files, archives, encrypted or compressed images, and combined factory images are not supported. Firmware is not downloaded automatically.

For **normal firmware updates**:

1. Select a firmware file, then choose **Start update**. Route Studio uses the current device connection or asks you to choose a device. **Connect Bluetooth** or **Connect USB** is also available to inspect the running version first.
2. Route Studio uploads the file, requests a test restart, reconnects and checks the running firmware. **Pause upload** stops between complete requests. After a disconnection, choose **Continue update** with the same file and device; the device's returned offset determines where transfer continues. After restart, Route Studio waits up to five minutes by default for the application to return, allowing time for MCUboot sector swapping. Expiry keeps the task pending; **Continue waiting** starts another waiting period without another upload or reset. **Reconnect and check** or **Check firmware status** explicitly checks the running image.
3. If the new firmware is running but unconfirmed, check that the device works correctly before choosing **Confirm firmware**. Firmware that confirms itself is recognized automatically. Success is reported only when the selected image is running and confirmed. A previous or different running image is reported separately.

For **USB recovery**, first enter the bootloader's serial recovery mode using the device's instructions. In **Menu → Device → USB recovery…**, acknowledge that the device is in recovery mode and choose **Connect USB** to select its serial port. **Recover firmware** writes the selected image; recovery can overwrite the running firmware, so keep USB connected until it finishes. Then choose **Restart device** and check that it starts correctly. Recovery uses upload and reset commands without the normal test/confirm sequence, and does not verify application health. It does not require a Bluetooth connection.

Bluetooth requires Web Bluetooth; USB requires Web Serial. Use HTTPS or localhost in a supporting browser, or the desktop app with the required OS permissions. USB defaults to standard SMP over console framing at 115200 baud. Raw binary framing and optional VID/PID filters are available in the connection profile and must match the device. Normal connections default to SMP v2; MCUboot recovery defaults to v1. Both can be changed before connecting. Entering recovery closes the normal connection; only one endpoint is active.

Firmware transfer state stays in memory while the app remains open. Closing or hiding a panel retains the selected file, connection and progress; reopen it from **Menu → Device** or the active task in the status bar. **End task…** asks for confirmation before stopping local tracking and releasing the connection for another task, including USB recovery. It keeps firmware already written to the device; an unconfirmed test image can still revert on a later restart. Choose **Keep task** to continue tracking it. Refreshing or closing the app loses local tracking state. The desktop app blocks closing or quitting during a firmware operation; pause or cancel the operation first. Device resets can also discard upload progress. Finish or cancel an active transfer before starting another transfer on the same connection. Selecting another file starts a new local workflow.

### Connection profiles

**Advanced connection settings** exposes a JSON profile for the selected connection. Bluetooth application mode, USB application mode and USB recovery save independent profiles in local storage. Disconnect and finish any pending task before applying changes. The protocol version is also available as a direct selector. **Load defaults** prepares a default profile; **Apply settings** validates and saves it. The full field reference is in [Device profiles](device-profiles.md).

In the send preview, connection settings appear above the route processing options. On smaller windows, scroll the preview to edit settings; the send action stays in the bottom bar.

On connection, Route Studio queries MCUmgr parameters and displays whether the buffer limit came from the device or a profile fallback. Only an explicit unsupported-command response permits fallback; malformed replies, timeouts and other errors remain errors. A reported buffer count does not enable concurrent requests. Upload data is sized to fit the actual encoded SMP request and the peer limit.

Web Bluetooth does not expose the negotiated ATT MTU. The safe default is 20 bytes per GATT write; a verified 247-byte ATT MTU allows a 244-byte write payload. Selecting 244 does not request a larger MTU. Reconnects reuse the original authorized device/serial-port handle, never a different port selected only by VID/PID. If the OS exposes a rebooted device as a new endpoint, automatic reconnection may need manual intervention; cross-transport migration of pending tasks is not supported.

## Desktop files and windows

Native open/save dialogs limit files to 64 MiB. Cancelling a save preserves edits. Closing warns about changes not saved as a project; exporting a route does not mark the project saved. Desktop drafts use a separate Electron profile. Drag empty toolbar space to move the window; Windows/Linux reveal the application menu with **Alt**.

## Software updates

Desktop **Settings… → Software update** shows the current version, release notes and update progress. **Check for updates…** is also available in the application menu. Automatic checks start 15 seconds after launch and run at most once per 24 hours, including failed attempts; the preference is saved immediately in the desktop profile. Manual checks bypass this interval. Background checks never open a modal or start a download. Available updates appear in the status bar and as a small upgrade icon beside **Save project** in the title bar. Hover over the icon to see the version, or click it to open **Software update**. The icon remains available during download and after a failed download so you can return to the update panel.

- **macOS:** unsigned builds check public GitHub Releases and open the matching Intel or Apple Silicon DMG in the browser (including Apple Silicon when running under Rosetta). Save the project, quit the app and replace it in Applications. No automatic installer is loaded on macOS.
- **Windows NSIS / Linux AppImage:** explicitly download the update, then choose **Restart and install**. Downloaded updates are not installed on ordinary quit. Unsaved projects require saving successfully or explicitly discarding changes. Saving, importing, exporting and Bluetooth selection/transfers block installation. AppImage installation requires write access to the file and its directory.
- **Linux DEB:** check for updates and download the matching package for manual installation. Development builds have updates disabled.

Only stable releases newer than the installed version are accepted; drafts, prereleases and downgrades are excluded. Update failures leave the editor usable and downloads can be retried. Update notes are displayed as text. No release token is shipped to clients. Projects, recovery drafts and preferences stay in their existing locations. Users of versions without this feature must install an update-capable version manually once.
