export type TransportKind = 'ble' | 'usb';
export type DeviceMode = 'application' | 'recovery';
export type ProfileKey = 'application-ble' | 'application-usb' | 'recovery-usb';
export interface ConnectionProfile {
  protocolVersion: 1 | 2;
  serialFraming: 'console' | 'raw';
  baudRate: number;
  dataBits: 7 | 8;
  stopBits: 1 | 2;
  parity: 'none' | 'even' | 'odd';
  flowControl: 'none' | 'hardware';
  dtr: 'preserve' | 'assert' | 'clear';
  rts: 'preserve' | 'assert' | 'clear';
  serialBufferBytes: number;
  usbFilters: { usbVendorId: number; usbProductId?: number }[];
  bleServiceUuid: string;
  bleCharacteristicUuid: string;
  bleWritePayloadBytes: number;
  bleMaxWritePayloadBytes: number;
  fragmentDelayMs: number;
  maxTxPacketBytes: number;
  maxRxPacketBytes: number;
  fallbackBufferBytes: number;
  queryParameters: boolean;
  firmwareChunkBytes: number;
  routeChunkBytes: number;
  connectTimeoutMs: number;
  requestTimeoutMs: number;
  firstUploadTimeoutMs: number;
  bootWaitMs: number;
  bootInitialDelayMs: number;
  bootRetryDelayMs: number;
  bootAttemptTimeoutMs: number;
  routePollIntervalMs: number;
  routeVerifyTimeoutMs: number;
  routePageSize: number;
  routeCatalogAttempts: number;
  routeReserveBytes: number;
  stalledUploadLimit: number;
  maxFirmwareBytes: number;
  imageIndex: number;
  recoveryUploadImage: number | null;
  upgradeOnly: boolean;
  activation: 'test' | 'upload-only';
  // Custom v1 errors require a device-defined mapping to route group errors.
  routeV1Errors: Record<string, number>;
}
export const DEFAULT_PROFILE: Readonly<ConnectionProfile> = {
  protocolVersion: 2,
  serialFraming: 'console',
  baudRate: 115200,
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
  flowControl: 'none',
  dtr: 'assert',
  rts: 'preserve',
  serialBufferBytes: 4096,
  usbFilters: [],
  bleServiceUuid: '8d53dc1d-1db7-4cd3-868b-8a527460aa84',
  bleCharacteristicUuid: 'da2e7828-fbce-4e01-ae9e-261174997c48',
  // Web Bluetooth cannot read negotiated ATT MTU. 244 is an explicit, verified override.
  bleWritePayloadBytes: 20,
  bleMaxWritePayloadBytes: 244,
  fragmentDelayMs: 0,
  maxTxPacketBytes: 1024,
  maxRxPacketBytes: 1024,
  fallbackBufferBytes: 1024,
  queryParameters: true,
  firmwareChunkBytes: 256,
  routeChunkBytes: 512,
  connectTimeoutMs: 60000,
  requestTimeoutMs: 60000,
  firstUploadTimeoutMs: 120000,
  bootWaitMs: 300000,
  bootInitialDelayMs: 3000,
  bootRetryDelayMs: 2000,
  bootAttemptTimeoutMs: 10000,
  routePollIntervalMs: 750,
  routeVerifyTimeoutMs: 120000,
  routePageSize: 4,
  routeCatalogAttempts: 3,
  routeReserveBytes: 4096,
  stalledUploadLimit: 8,
  maxFirmwareBytes: 64 * 1024 * 1024,
  imageIndex: 0,
  recoveryUploadImage: null,
  upgradeOnly: false,
  activation: 'test',
  routeV1Errors: {},
};
export function profileKey(mode: DeviceMode, transport: TransportKind): ProfileKey {
  return mode === 'recovery' ? 'recovery-usb' : `application-${transport}`;
}
export function defaultProfile(key: ProfileKey): ConnectionProfile {
  return structuredClone({
    ...DEFAULT_PROFILE,
    ...(key === 'recovery-usb' && {
      protocolVersion: 1,
      fallbackBufferBytes: 256,
    }),
  });
}
const ranges: Partial<Record<keyof ConnectionProfile, readonly [number, number]>> = {
  baudRate: [1, 4000000],
  serialBufferBytes: [128, 16777215],
  bleWritePayloadBytes: [1, 512],
  bleMaxWritePayloadBytes: [1, 512],
  fragmentDelayMs: [0, 1000],
  maxTxPacketBytes: [64, 65533],
  maxRxPacketBytes: [64, 65533],
  fallbackBufferBytes: [64, 65533],
  firmwareChunkBytes: [1, 65525],
  routeChunkBytes: [1, 65525],
  connectTimeoutMs: [100, 600000],
  requestTimeoutMs: [100, 600000],
  firstUploadTimeoutMs: [100, 1800000],
  bootWaitMs: [1000, 3600000],
  bootInitialDelayMs: [0, 60000],
  bootRetryDelayMs: [100, 60000],
  bootAttemptTimeoutMs: [100, 60000],
  routePollIntervalMs: [100, 60000],
  routeVerifyTimeoutMs: [1000, 3600000],
  routePageSize: [1, 256],
  routeCatalogAttempts: [1, 20],
  routeReserveBytes: [0, 1073741824],
  stalledUploadLimit: [1, 100],
  maxFirmwareBytes: [32, 1073741824],
  imageIndex: [0, 255],
};
export function validateProfile(value: unknown, key: ProfileKey): ConnectionProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid device profile');
  const input = value as Record<string, unknown>;
  const defaults = defaultProfile(key);
  for (const name of Object.keys(input))
    if (!Object.hasOwn(defaults, name)) throw new Error(`Unknown setting: ${name}`);
  const result = { ...defaults, ...input } as ConnectionProfile;
  for (const [name, range] of Object.entries(ranges)) {
    const v = result[name as keyof ConnectionProfile];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < range[0] || v > range[1])
      throw new Error(`Invalid setting: ${name}`);
  }
  const choices = {
    protocolVersion: [1, 2],
    serialFraming: ['console', 'raw'],
    dataBits: [7, 8],
    stopBits: [1, 2],
    parity: ['none', 'even', 'odd'],
    flowControl: ['none', 'hardware'],
    dtr: ['preserve', 'assert', 'clear'],
    rts: ['preserve', 'assert', 'clear'],
    activation: ['test', 'upload-only'],
  };
  for (const [name, values] of Object.entries(choices))
    if (!(values as unknown[]).includes(result[name as keyof ConnectionProfile]))
      throw new Error(`Invalid setting: ${name}`);
  for (const name of ['queryParameters', 'upgradeOnly'] as const)
    if (typeof result[name] !== 'boolean') throw new Error(`Invalid setting: ${name}`);
  for (const name of ['bleServiceUuid', 'bleCharacteristicUuid'] as const)
    if (
      typeof result[name] !== 'string' ||
      !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(result[name])
    )
      throw new Error(`Invalid setting: ${name}`);
  const uint16 = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 65535;
  if (
    !Array.isArray(result.usbFilters) ||
    result.usbFilters.some(
      (f) => !f || !uint16(f.usbVendorId) || (f.usbProductId !== undefined && !uint16(f.usbProductId)),
    )
  )
    throw new Error('Invalid setting: usbFilters');
  if (result.recoveryUploadImage !== null && !uint16(result.recoveryUploadImage))
    throw new Error('Invalid setting: recoveryUploadImage');
  if (
    !result.routeV1Errors ||
    typeof result.routeV1Errors !== 'object' ||
    Array.isArray(result.routeV1Errors) ||
    Object.entries(result.routeV1Errors).some(([k, v]) => !/^[1-9]\d*$/.test(k) || !uint16(v) || v === 0)
  )
    throw new Error('Invalid setting: routeV1Errors');
  if (result.serialFraming === 'raw' && result.dataBits !== 8)
    throw new Error('Raw SMP requires 8 data bits');
  return structuredClone(result);
}
export function loadProfile(key: ProfileKey): ConnectionProfile {
  try {
    const saved = globalThis.localStorage?.getItem(`route-studio.device.${key}`);
    if (saved) return validateProfile(JSON.parse(saved), key);
  } catch {
    /* Unsupported storage or an obsolete profile uses defaults. */
  }
  return defaultProfile(key);
}
export function saveProfile(key: ProfileKey, value: ConnectionProfile): boolean {
  try {
    if (!globalThis.localStorage) return false;
    globalThis.localStorage.setItem(`route-studio.device.${key}`, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
export function transportSupported(kind: TransportKind) {
  return (
    window.isSecureContext &&
    !!(kind === 'ble' ? navigator.bluetooth?.requestDevice : navigator.serial?.requestPort)
  );
}
