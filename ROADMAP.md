# Route Studio roadmap

## v0.1 · Desktop route editor

- Open GPX, KML, or RTE files, or draw a new route. Work in English or Simplified Chinese.
- Edit geometry and elevation, and undo or redo changes. Set the on-route position and physical coordinates of each checkpoint or point of interest independently.
- Save incomplete routes as `.routeproj` files and recover the current draft in the same browser.
- Edit on a local coordinate grid, validate routes, and download device-ready RTE files. Test RTE round trips against the pinned specification.

**Exported route confirmed working on a physical device.** On November 3, 2026, an exported route was tested on hardware and reported to work correctly. A local build of the firmware route reader also successfully opened the 164.2323 km UMY100M test route.

## v0.2 · Bluetooth upload

- The editor sends the previewed RTE over MCUmgr Bluetooth to a user-entered file path. It shows progress as the device acknowledges each chunk and verifies the device file's length and IEEE CRC32. File download remains available.
- On November 3, 2026, the Bluetooth upload was tested on a physical Arcap device. The tester used **Bluetooth upload…** beside **Download RTE**, entered the device path, and uploaded the route. The file length and IEEE CRC32 reported by the device matched the exported RTE.
- Cancellation and retry after a disconnect still need hardware testing. Same-name replacement is planned once the device can preserve the previous route through a failed transfer.

## File formats

- FIT Course and Activity import is available, including selection of GPS sessions and placement of course points by timestamp or recorded distance.

## Later candidates

- Add FIT, GPX and KML export. Explain which route information each target format can preserve.
- Consider an Electron shell if device connectivity or local file workflows require native desktop capabilities. Reuse the existing route model and format modules.

As the RTE specification evolves, pin each adopted revision to a commit and update the reference vectors, firmware reader tests, and physical device acceptance record together.
