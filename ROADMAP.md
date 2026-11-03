# Route Studio roadmap

## v0.1 · Desktop route editor

- Open GPX, KML, or RTE files, or draw a new route. Work in English or Simplified Chinese.
- Edit geometry and elevation, and undo or redo changes. Set the on-route position and physical coordinates of each checkpoint or point of interest independently.
- Save incomplete routes as `.routeproj` files and recover the current draft in the same browser.
- Edit on a local coordinate grid, validate routes, and download device-ready RTE files. Test RTE round trips against the pinned specification.

**Exported route confirmed working on a physical device.** On November 3, 2026, an exported route was tested on hardware and reported to work correctly. A local build of the firmware route reader also successfully opened the 164.2323 km UMY100M test route.

## v0.2 · Bluetooth upload

Send a validated RTE file directly from a supported desktop browser to a device. Agree on the Bluetooth service and write protocol with the firmware implementation. Show transfer progress, support cancellation and retry after a disconnect, verify file integrity, and replace an existing route only after a successful transfer. Test interrupted uploads and same-name replacements on hardware. Keep file download available.

## Later candidates

- Add FIT import and export, and support GPX and KML export. Explain which route information each target format can preserve.
- Consider an Electron shell if device connectivity or local file workflows require native desktop capabilities. Reuse the existing route model and format modules.

As the RTE specification evolves, pin each adopted revision to a commit and update the reference vectors, firmware reader tests, and physical device acceptance record together.
