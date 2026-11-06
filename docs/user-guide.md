# User guide

[Documentation](README.md) · [Project overview](../README.md)

Edit routes, preserve work in project files, and send routes to a TRL-X device. See [format support](formats.md) for import and export limits.

## Editing routes

1. Open a file through **Menu → File**, drop a file, or choose **Menu → File → New route**. For files containing multiple tracks or sessions, select a route to edit.
2. Append, insert or drag route points. Add stations on the route, choosing the intended pass when a route visits the same location more than once. A station's route distance and landmark coordinates can be edited independently.
3. Imports with missing elevations prompt you to fill short gaps or preview a full online replacement. Gaps up to 1,000 m can be interpolated from existing heights; longer gaps or a missing profile need terrain data. Choose **Later** to keep editing, then return via **Elevation tools…** in the profile or **Menu → Route**. Online requests start only when you choose the online preview; review it before **Replace all elevations**. Both edits can be undone.
4. Save a `.routeproj` to preserve unfinished edits, missing heights, station settings and magnetic data. Recovery drafts are saved locally; use project files for backups and transfer between computers.
5. Open **Export…**, select RTE, GPX, KML or FIT, then resolve blocking issues and review the output before downloading. RTE processing defaults to 10 m elevation spacing, 2 m geometry tolerance and 10 m smoothing; these settings affect the export, not the project.

## Resampling

Use **Menu → Route → Resample route points…** after drawing or editing a route to redistribute its geometry points. Defaults are 2–20 m spacing and at most 0.5 m shape deviation. The preview overlays the original and resampled routes, reports point counts, length changes and actual spacing, and locates short segments retained for stations, turns or endpoints. Minimum spacing is a target; preserving these features takes priority. Station details and existing elevation samples (including missing heights) are retained. Parameter changes always start from the original route; **Apply resampling** changes the project in one undoable edit. Calculations can be cancelled and are limited to 100,000 output points plus a bounded processing budget.

## Appearance and layout

The interface uses Radix Themes with system fonts, neutral surfaces and a blue accent. **Settings… → General** controls language and appearance; appearance follows the system by default. The inspector groups related properties, and narrow windows provide **Route outline** and **Edit selection** panels. Drag the profile divider, or focus it and use arrow keys, to resize the chart.

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

### Bluetooth

Open **Device…** from the toolbar Bluetooth icon or the main **Menu** to connect, inspect capacity, refresh the route list, and delete unused routes. From the RTE preview, choose **Connect and send…**, or **Send to [device name]** when connected. Pairing is followed by sending automatically. **View device routes** and **Manage device routes** switch to the same device panel; **Back to export** restores the export settings. **Disconnect** and **Connect another device** are directly available in the device panel. The toolbar icon is blue when connected and gray with a slash when disconnected.

Route Studio uses Arcap Custom MCUmgr Group 64 to prepare a temporary file, transfers it through FS Group 8, and waits for device validation and catalog publication before reporting success. Names come from RTE metadata; no device path is required.

After a disconnection, choose **Reconnect and continue**; the original export bytes are retained while the app stays open. Uploads can be cancelled before validation starts. Device restart or transaction expiry may require a fresh upload; refresh/close of the app loses the local recovery state.

Web use requires HTTPS or localhost and Web Bluetooth support; desktop use requires OS permission and a working adapter. Physical-device acceptance testing is still required on each platform.

## Desktop files and windows

Native open/save dialogs limit files to 64 MiB. Cancelling a save preserves edits. Closing warns about changes not saved as a project; exporting a route does not mark the project saved. Desktop drafts use a separate Electron profile. Drag empty toolbar space to move the window; Windows/Linux reveal the application menu with **Alt**.

## Software updates

Desktop **Settings… → Software update** shows the current version, release notes and update progress. **Check for updates…** is also available in the application menu. Automatic checks start 15 seconds after launch and run at most once per 24 hours, including failed attempts; the preference is saved immediately in the desktop profile. Manual checks bypass this interval. Background checks never open a modal or start a download. Available updates appear in the status bar.

- **macOS:** unsigned builds check public GitHub Releases and open the matching Intel or Apple Silicon DMG in the browser (including Apple Silicon when running under Rosetta). Save the project, quit the app and replace it in Applications. No automatic installer is loaded on macOS.
- **Windows NSIS / Linux AppImage:** explicitly download the update, then choose **Restart and install**. Downloaded updates are not installed on ordinary quit. Unsaved projects require saving successfully or explicitly discarding changes. Saving, importing, exporting and Bluetooth selection/transfers block installation. AppImage installation requires write access to the file and its directory.
- **Linux DEB:** check for updates and download the matching package for manual installation. Development builds have updates disabled.

Only stable releases newer than the installed version are accepted; drafts, prereleases and downgrades are excluded. Update failures leave the editor usable and downloads can be retried. Update notes are displayed as text. No release token is shipped to clients. Projects, recovery drafts and preferences stay in their existing locations. Users of versions without this feature must install an update-capable version manually once.
