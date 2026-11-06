# File formats

[Documentation](README.md) · [Project overview](../README.md)

Route Studio imports FIT, GPX, KML and RTE and exports RTE, GPX, KML and FIT. Save a `.routeproj` to preserve the complete editable project, including unfinished edits and missing heights.

## Import behavior

FIT Course and GPS Activity sessions are supported. Enhanced altitude takes precedence over standard altitude; missing heights remain editable. Training measurements are not retained, and distances are calculated from geometry. Station matching uses recorded timestamps and distances where available to distinguish repeated visits.

GPX waypoints become checkpoints; KML points are matched to nearby routes and otherwise remain unassigned. Endpoint markers can supply start/finish names. KML heights without a declared altitude mode require confirmation on import.

## Export behavior

| Export     | Contents and limits                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| RTE        | Device route, stations, elevation and optional magnetic declination. Processing preserves endpoints and stage boundaries.                        |
| GPX 1.1    | Track vertices, elevation samples and named station waypoints. Waypoints cannot distinguish repeated visits.                                     |
| KML 2.2    | Route line and named station points. Absolute altitude requires a complete mean-sea-level profile; otherwise the preview explains the 2D export. |
| FIT Course | Distance, available heights and anchored course points linked to the intended visit. Synthetic timestamps order records one second apart.        |

Previews report stations that cannot be exported. Keep the project file to preserve all editor-specific information.

## RTE compatibility

RTE support targets the **November 1, 2026 draft of TRL-X Route 1.0**: [pinned specification and reference vectors](https://github.com/TRL-X/route-specification/tree/6918eb7aa438186589a516f8caccb03b960c6c0e). Unknown noncritical sections and META extension keys are dropped; unknown critical sections are rejected. Reader limits are 64 MiB, 256 sections, one million GEOM/ELEV/GIDX records each, and 8 MiB / 24 nesting levels / 250,000 items for META. Devices may impose lower limits.

See the [user guide](user-guide.md#editing-routes) for the editing workflow and [architecture](architecture.md#route-document-model) for the project model.
