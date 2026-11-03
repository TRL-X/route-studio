# Route Studio

Route Studio is a desktop browser editor for preparing routes for TRL-X devices. Open a FIT, GPX, KML, or RTE file, edit the course and its elevation profile, then export the edited route as RTE, GPX, KML, or FIT. The interface is available in English and Simplified Chinese.

## Run locally

Use Node.js 24 and npm to install dependencies and start the dev server from the repository root.

```sh
npm ci
npm run dev
```

Open the local URL printed in the terminal. The editor opens with an editable example unless there is a draft to recover. To build for deployment, run `npm run build` and serve the contents of `dist/` from a static web host. Use `npm run preview` to check the production build locally.

## Prepare a route

1. Choose **Open**, drop a file onto the editor, or start drawing with **File → New route**. If a FIT activity contains several GPS sessions, a GPX contains multiple tracks or segments, or a KML contains several lines, select the course you want to edit. A GPX waypoint or KML point named for the start or finish within 100 m of a matching endpoint supplies that station's name and landmark coordinates. On a closed course, a shared start/finish marker can supply both stations. Other points become checkpoints with **Stage boundary** enabled. You can edit their settings in the station inspector.
2. Use **Append point** or **Insert point** to change the geometry. Drag a point with **Select**, or edit its coordinates in the inspector. To add a station, choose **Add station**, move near the route to preview its distance, and click to place it. Press **Esc** to cancel the preview. If the route passes the same place twice, choose the distance and neighboring stations for the intended pass. You can also adjust an existing station's **Route distance (km)** independently of its landmark coordinates.
3. Choose **Fill elevation gaps** above the profile to fill gaps up to 1,000 m long. Interior gaps use linear interpolation. A gap at the start or finish takes the nearest known height along the route. If gaps remain or the route has no heights, the editor fetches a GLO-30 preview for the whole route. Local gap filling is a separate undoable edit. When a KML supplies heights without an altitude mode, choose whether to use them on import.
4. Choose **Save project** to download a `.routeproj` file. Projects preserve unfinished edits, including missing heights. The editor also saves a recovery draft in the browser's IndexedDB. Use the project file for backups or to continue on another computer.
5. Choose **Export RTE…** to check the route, review the output, set the filename and download the previewed bytes. Blocking errors can be opened in the inspector. For GPX, KML, or FIT, choose the arrow beside **Export RTE…**, select the format, review the preview and download the file.
6. Under **Route processing options**, the defaults are **10 m** for elevation sample spacing, **2 m** for geometry tolerance, and **10 m** for the smoothing window. Compare the profiles, node counts, ascent and file size as you adjust the settings. Endpoints and stage boundaries stay at their original distances. To preserve the project samples and geometry, choose **Keep project samples** and switch geometry tolerance and smoothing off. If samples share a 0.1 m device position, expand the processing record to see which height was used. These settings apply only to the device file and are remembered while editing this route in the current session.

When **Export RTE…** opens, new routes and FIT/GPX/KML imports in **Magnetic declination → Automatic lookup** query BGS WMM2025 using the route’s distance midpoint, zero ellipsoid height, and an editable UTC date. Only that coordinate and date are shared with BGS. A successful result is saved with the project for offline export. Change the midpoint or date to refresh it. If lookup fails, retry, enter a manual value in degrees (east positive, west negative), or choose **Omit** to export without declination. Imported RTE files keep their original value, dates, and reference location, including an absent value, until you edit them.

To send the previewed RTE to an Arcap device, open the editor over HTTPS or localhost in a browser with Web Bluetooth. Open **Export RTE…** and choose **Bluetooth upload…** next to **Download RTE**. Enter the full device path including a new filename, for example `/SD:/ROUTES/TEST.RTE`. The directory must already exist. Put the device into pairing mode if needed, then choose **Select device and upload**. Route Studio checks the device file's length and IEEE CRC32 against the preview bytes. An identical file at the chosen path also passes verification. If another file occupies that path, choose a different filename. An interrupted upload can leave a partial file at the destination.

Select a station or sample to keep its position marked while you inspect nearby points. In a narrow window, select an object and choose **Edit selection** to open its inspector. Drag the divider above the elevation profile to change its height, or focus the divider and use the arrow keys.

Choose **Get elevations online** to fetch a GLO-30 profile. The chart overlays the current and proposed elevations and highlights stretches worth checking.

When every sample has terrain data, choose **Replace all elevations** to apply the EGM2008 heights in one undoable edit. Cancel to keep the current profile.

| Shortcut             | Action                                                  |
| -------------------- | ------------------------------------------------------- |
| `Ctrl/⌘ + O`         | Open a file                                             |
| `Ctrl/⌘ + S`         | Save a project file                                     |
| `Ctrl/⌘ + Z`         | Undo                                                    |
| `Ctrl/⌘ + Shift + Z` | Redo                                                    |
| `Esc`                | Close a menu or dialog and return to the selection tool |

Route editing and file conversion run in the browser. The online basemap is enabled by default, so MapLibre requests map resources for the current view from OpenFreeMap. You can turn it off to use a local coordinate grid; the map also falls back to the grid if the basemap is unavailable. To use a different provider, set `VITE_MAP_STYLE_URL` in `.env.local` to the URL of a MapLibre style, then restart the dev server or rebuild.

Online terrain lookup requests one-degree tiles and byte ranges from the [Microsoft Planetary Computer GLO-30 collection](https://planetarycomputer.microsoft.com/dataset/cop-dem-glo-30). The editor samples the nearest grid point in the browser, adding samples about every 60 m on long intervals. The model measures surface heights and may represent treetops or the hillside above a tunnel. See the [Copernicus dataset and attribution](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM).

## Code and format support

The application uses TypeScript, React, Vite, and MapLibre GL JS.

Write code, comments, and documentation in English. Keep user-facing translations in the locale resources under `src/i18n/`.

| Directory     | Responsibility                                                                          |
| ------------- | --------------------------------------------------------------------------------------- |
| `src/domain/` | Route geometry, independent elevation samples, station anchors, and editing operations  |
| `src/files/`  | FIT, GPX and KML import, versioned project files, and local draft recovery              |
| `src/rte/`    | Binary RTE parsing and validation, plus compilation from an editable route              |
| `src/app/`    | Desktop controls, undo and redo, language selection, and the file-processing Web Worker |
| `src/i18n/`   | English and Simplified Chinese interface text and RTE diagnostics                       |
| `src/views/`  | Map interaction and the linked elevation profile                                        |

FIT import accepts Course files and Activity files with GPS records. Activity imports use each recorded session as a separate route and omit records without GPS coordinates. The editor uses enhanced altitude when present, falls back to altitude, and leaves missing heights editable. Heart rate, timing and other training measurements are not stored in the project. Distances in the editor are calculated from the imported geometry and can differ from the device's recorded distance.

FIT course points become stations. A checkpoint becomes a stage boundary, and other cues become points of interest. Route Studio uses matching record timestamps, then recorded distance, to place a station on the intended pass. If only its coordinates identify it and the route passes there twice, the station keeps its landmark coordinates for manual placement.

| Export format | Route information                                                                                                                                                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GPX 1.1       | One track with the project vertices and independent elevation samples. Each known height is written in metres. Stations become named waypoints at their landmark coordinates, falling back to their position on the route.                                                                        |
| KML 2.2       | One line and named point placemarks. A complete mean-sea-level profile is written with absolute altitude. Other profiles are exported in 2D, with the reason shown before download.                                                                                                               |
| FIT Course    | Route records include cumulative distance and available heights. Each anchored station has a course point linked to the record for that visit, even on a loop or an out-and-back. Unassigned stations are listed before download. Generated timestamps order the course records one second apart. |

GPX and KML waypoints do not identify which visit to a location was intended. All three previews indicate which stations cannot be written. Save a `.routeproj` to keep custom stage boundaries, short labels, magnetic settings and the original independent sampling. RTE processing options, magnetic lookup and Bluetooth upload apply only to RTE.

Elevation samples and stations attach to route segments using stable vertex IDs and fractional positions. A Web Worker handles file import and RTE compilation. During export, the compiler establishes the device's reference distance axis, computes stage statistics, and writes the geometry index. For imported RTE files, it reuses valid distance mappings so an unrelated edit, such as renaming a route, can preserve the original sampling.

The implementation targets the **November 1, 2026 draft of TRL-X Route 1.0**. RTE round trips preserve the information defined by that revision. The importer drops unknown noncritical sections and META extension keys, and rejects unknown critical sections. [Pinned specification and reference vectors](https://github.com/TRL-X/route-specification/tree/6918eb7aa438186589a516f8caccb03b960c6c0e)

The desktop RTE reader accepts files up to 64 MiB with at most 256 sections. GEOM, ELEV, and GIDX each support up to one million records. META is limited to 8 MiB, 24 levels of CBOR nesting, and 250,000 CBOR items. A target device may impose lower limits.

## Contribute with GitHub Flow

1. Start each change on a short-lived branch from the latest `main`. Open a pull request targeting `main`.
2. Request a review when you want another maintainer's feedback. Before merging, bring the branch up to date with `main`, resolve review conversations, and wait for the `verify` job in **Check editor** to pass.
3. A member of the [Route Studio mergers team](https://github.com/orgs/TRL-X/teams/route-studio-mergers) uses **Squash and merge**. The PR title becomes the commit title on `main`, and GitHub deletes the merged branch.

## Verify changes

```sh
npm run check
npx playwright install chromium
npm run test:e2e
```

`check` runs formatting checks, unit tests, type checks, and a production build. Playwright tests exercise file selection and download in desktop Chromium, including project recovery, elevation correction, and RTE export. Local acceptance checks used eight GPX and KML fixtures kept outside the repository. All eight routes passed round-trip checks after their height conflicts and gaps were resolved.

See the [roadmap](ROADMAP.md) for device acceptance and planned releases.
