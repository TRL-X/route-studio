# Device profiles

[Documentation](README.md) · [Device connections](user-guide.md#device-connections)

Open **Advanced connection settings** in a device panel to edit and apply a JSON profile. Profiles are stored separately for application Bluetooth, application USB and MCUboot USB recovery. Omitted fields receive the scenario defaults; unknown fields and invalid values are rejected. Restore defaults with **Load defaults**, then **Apply settings**. Changes require a disconnected, idle session and apply to the next connection. An active or interrupted task retains its profile until explicitly ended.

## Connection settings

| Field                            | Default                                | Meaning                                                                                                                                   |
| -------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `protocolVersion`                | `2`, recovery `1`                      | SMP version for every command in this connection. No silent downgrade.                                                                    |
| `serialFraming`                  | `"console"`                            | Console/Base64/CRC or `"raw"` binary SMP; must match firmware.                                                                            |
| `baudRate`                       | `115200`                               | Serial line rate. Some native CDC implementations ignore it.                                                                              |
| `dataBits`, `parity`, `stopBits` | `8`, `"none"`, `1`                     | Serial framing. Raw SMP requires eight data bits.                                                                                         |
| `flowControl`                    | `"none"`                               | May be `"hardware"` when supported by the device.                                                                                         |
| `dtr`, `rts`                     | `"assert"`, `"preserve"`               | Each accepts preserve, assert or clear. Hardware flow control owns RTS.                                                                   |
| `serialBufferBytes`              | `4096`                                 | Host stream buffer size, separate from the peer SMP buffer.                                                                               |
| `usbFilters`                     | `[]`                                   | Optional objects with `usbVendorId` and optional `usbProductId`. Filters identify candidates, not physical identity.                      |
| `bleServiceUuid`                 | `8d53dc1d-1db7-4cd3-868b-8a527460aa84` | SMP service.                                                                                                                              |
| `bleCharacteristicUuid`          | `da2e7828-fbce-4e01-ae9e-261174997c48` | SMP write/notification characteristic.                                                                                                    |
| `bleWritePayloadBytes`           | `20`                                   | Bytes per GATT write, not ATT MTU. A verified ATT MTU of 247 permits 244 bytes; the write size is capped by `bleMaxWritePayloadBytes`.    |
| `bleMaxWritePayloadBytes`        | `244`                                  | Device-profile ceiling for write payloads. Both BLE sizes can be configured up to the host API limit of 512; this does not negotiate MTU. |
| `fragmentDelayMs`                | `0`                                    | Optional delay between BLE writes or console frames. Writes remain sequential.                                                            |

Web Bluetooth cannot query negotiated MTU, so a firmware maximum of 247 alone does not select 244-byte writes. This implementation does not invent a device-specific MTU or identity query. Ordinary browser permission and OS pairing mechanisms still apply.

## Packet budgets and capabilities

| Field                                  | Default                | Meaning                                                                                                           |
| -------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `maxTxPacketBytes`, `maxRxPacketBytes` | `1024` each            | Independent host SMP packet budgets, including the eight-byte header and CBOR.                                    |
| `queryParameters`                      | `true`                 | Query OS group 0, command 6 before publishing a connected session.                                                |
| `fallbackBufferBytes`                  | `1024`, recovery `256` | Peer budget assumed only when the query explicitly returns generic ENOTSUP, or querying is deliberately disabled. |
| `firmwareChunkBytes`                   | `256`                  | Preferred file bytes per image upload request.                                                                    |
| `routeChunkBytes`                      | `512`                  | Preferred file bytes per route upload request, additionally limited by route `max_chunk`.                         |

The effective transmit budget is the minimum of the host budget and the reported/assumed peer buffer. Each chunk is fitted using its actual CBOR encoding, including first-packet metadata. A report of `buf_size: 1024, buf_count: 4` permits packets up to 1024 bytes, not 1024 file bytes. Buffer count is displayed but does not enable pipelining: the request engine supports one in-flight request per connection.

Timeouts, disconnects, invalid parameter fields and errors other than explicit ENOTSUP stop connection setup. Retrying connection repeats the read-only probe. App and MCUboot capabilities are queried independently; fallback is labelled as profile data, and an unknown count is displayed as unknown. The recovery fallback is a conservative starting value, not a guaranteed minimum; set it from the actual MCUboot build when necessary. Receiver limits, invalid response matching and protocol constants cannot be disabled by a profile.

## Timeouts and transfer behavior

All time fields use milliseconds.

| Field                  | Default  | Meaning                                                                      |
| ---------------------- | -------- | ---------------------------------------------------------------------------- |
| `connectTimeoutMs`     | `60000`  | Entire connection setup, including selection and parameter query.            |
| `requestTimeoutMs`     | `60000`  | A normal SMP exchange.                                                       |
| `firstUploadTimeoutMs` | `120000` | Image offset-zero request, which may erase Flash.                            |
| `bootWaitMs`           | `300000` | Total wait after a requested normal-update restart.                          |
| `bootInitialDelayMs`   | `3000`   | Delay before the first boot check.                                           |
| `bootRetryDelayMs`     | `2000`   | Delay after an unsuccessful boot check.                                      |
| `bootAttemptTimeoutMs` | `10000`  | Connection/check attempt limit, capped by the remaining boot budget.         |
| `routePollIntervalMs`  | `750`    | Delay between route verification polls.                                      |
| `routeVerifyTimeoutMs` | `120000` | Route verification polling budget per invocation.                            |
| `routePageSize`        | `4`      | Requested catalog page size; must be supported by the route implementation.  |
| `routeCatalogAttempts` | `3`      | Catalog snapshot attempts after an explicit revision conflict.               |
| `routeReserveBytes`    | `4096`   | Extra free storage required by route upload preflight.                       |
| `stalledUploadLimit`   | `8`      | Allowed consecutive image responses without advancing the high-water offset. |

There is no automatic transport failover, protocol downgrade, blind mutation retry or background reconnect after an ordinary disconnect. Task recovery queries authoritative device state. Packet errors invalidate the link. Normal-update restart checks are automatic and read-only; expiry preserves `awaitingReconnect` and the task lock. **Continue waiting** starts a new budget without uploading or resetting again. An OS endpoint appearing is not success: the chosen image must be running, and completion requires confirmation.

MCUboot swap-using-offset can take significantly longer than an ordinary restart. Tune `bootWaitMs` using worst-case physical-device measurements. The upload `off` remains a file offset; physical Flash sector placement belongs to the device firmware.

## Image behavior and v1 route compatibility

| Field                 | Default    | Meaning                                                                                                                                                                                                    |
| --------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxFirmwareBytes`    | `67108864` | Local file limit; does not increase the device slot capacity.                                                                                                                                              |
| `imageIndex`          | `0`        | Application image selected for normal upload and subsequent state checks. Default zero is omitted from the upload command for compatibility.                                                               |
| `recoveryUploadImage` | `null`     | Omit target to use MCUboot's default. Only set a numeric target with a verified bootloader mapping. This is not an application slot number.                                                                |
| `upgradeOnly`         | `false`    | When enabled, include `upgrade: true` on the first upload packet; requires firmware support.                                                                                                               |
| `activation`          | `"test"`   | Normal **Start update** automatically test-boots; `"upload-only"` stops after verified upload. Explicit **Restart and test** remains available.                                                            |
| `routeV1Errors`       | `{}`       | Device-defined mapping from v1 numeric `rc` values to custom route group 64 codes. For example, `{ "101": 11 }` maps a documented device code 101 to a stale-catalog error. Do not guess mappings from v2. |

Confirmation remains an explicit user action, or is recognized when the firmware confirms itself. Recovery never test-boots or confirms automatically. Image format and digest validation remain mandatory. Device slot limits, signing policy, enabled commands and Flash layout remain firmware responsibilities; a profile setting cannot add a missing capability.
