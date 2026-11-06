# Route Studio

A route editor for TRL-X devices, available on the web and as an Electron desktop app. Import FIT, GPX, KML or RTE, edit geometry, stations and elevations, then export RTE, GPX, KML or FIT. The interface supports English and Simplified Chinese.

Save editable work as `.routeproj` files and send exported RTE routes to a device over Bluetooth. The installed desktop app works offline for local editing and conversion; maps, terrain and magnetic lookup require internet access.

## Quick start

Use Node.js 24 and npm:

```sh
npm ci
npm run dev
```

For the desktop app, after installing dependencies:

```sh
npx install-electron --no
npm run desktop:dev
```

See [development and verification](docs/development.md) for build commands, testing and troubleshooting. Desktop installers are distributed through [GitHub Releases](https://github.com/TRL-X/route-studio/releases).

## Documentation

Start with the [documentation index](docs/README.md), or go directly to a guide:

| Guide                                | Contents                                                                |
| ------------------------------------ | ----------------------------------------------------------------------- |
| [User guide](docs/user-guide.md)     | Editing, elevation tools, device upload and desktop updates.            |
| [File formats](docs/formats.md)      | Import/export behavior, information loss and RTE compatibility.         |
| [Development](docs/development.md)   | Setup, configuration, verification commands and test coverage.          |
| [Architecture](docs/architecture.md) | Current modules, route model, data flow and runtime boundaries.         |
| [Releasing](docs/releasing.md)       | Desktop packaging, signing and update artifact verification.            |
| [Contributing](CONTRIBUTING.md)      | Pull requests, CI selection, merge queue and documentation conventions. |

## License

[GNU Affero General Public License v3.0 only](LICENSE).
