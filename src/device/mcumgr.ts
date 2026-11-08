import { DEFAULT_PROFILE, type ConnectionProfile } from './config';
import { DeviceError, PacketDecoder, smpRequest, delay, type SmpRequest } from './smp';
export { DeviceError, checked, record, type Fields, type SmpRequest } from './smp';
export function requestClient(
  channel: BluetoothRemoteGATTCharacteristic,
  signal: AbortSignal,
  invalidate: (error: unknown) => void,
  protocolVersion: 1 | 2 = DEFAULT_PROFILE.protocolVersion,
  profile: Readonly<ConnectionProfile> = DEFAULT_PROFILE,
): SmpRequest {
  return smpRequest(
    async (frame, active) => {
      const decoder = new PacketDecoder(profile.maxRxPacketBytes);
      const response = new Promise<Uint8Array>((resolve, reject) => {
        channel.addEventListener(
          'characteristicvaluechanged',
          () => {
            try {
              const value = channel.value;
              if (!value?.byteLength) throw new DeviceError('protocol');
              const packets = decoder.push(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
              if (packets.length > 1 || (packets.length && decoder.pendingBytes))
                throw new DeviceError('protocol');
              if (packets.length) resolve(packets[0]);
            } catch (error) {
              reject(error);
            }
          },
          { signal: active },
        );
        active.addEventListener('abort', () => reject(active.reason), { once: true });
      });
      const write = async () => {
        const fragmentBytes = Math.min(profile.bleWritePayloadBytes, profile.bleMaxWritePayloadBytes);
        for (let offset = 0; offset < frame.length; offset += fragmentBytes) {
          active.throwIfAborted();
          await channel.writeValueWithoutResponse(
            new Uint8Array(frame.subarray(offset, offset + fragmentBytes)),
          );
          if (profile.fragmentDelayMs) await delay(profile.fragmentDelayMs, active);
        }
      };
      const [reply] = await Promise.all([response, write()]);
      return reply;
    },
    signal,
    invalidate,
    { ...profile, protocolVersion },
  );
}
export interface DeviceConnection {
  device: BluetoothDevice;
  request: SmpRequest;
  close: () => void;
}

export async function connectBluetooth(
  signal: AbortSignal,
  onLost: () => void,
  previous?: BluetoothDevice,
  protocolVersion: 1 | 2 = DEFAULT_PROFILE.protocolVersion,
  profile: Readonly<ConnectionProfile> = DEFAULT_PROFILE,
): Promise<DeviceConnection> {
  signal.throwIfAborted();
  const cancelSelection = () => window.routeStudioDesktop?.cancelBluetooth();
  signal.addEventListener('abort', cancelSelection, { once: true });
  let device: BluetoothDevice;
  try {
    device =
      previous ??
      (await navigator.bluetooth.requestDevice({ filters: [{ services: [profile.bleServiceUuid] }] }));
  } catch (error) {
    // Only chooser dismissal is cancellation; GATT NotFoundError failures must still surface.
    if (error instanceof DOMException && error.name === 'NotFoundError')
      throw new DOMException(error.message, 'AbortError');
    throw error;
  } finally {
    signal.removeEventListener('abort', cancelSelection);
  }
  signal.throwIfAborted();
  const gatt = device.gatt;
  if (!gatt) throw new DeviceError('disconnected');
  const link = new AbortController();
  const active = AbortSignal.any([signal, link.signal]);
  const close = () => {
    device.removeEventListener('gattserverdisconnected', lost);
    signal.removeEventListener('abort', close);
    link.abort(new DeviceError('disconnected'));
    gatt.disconnect();
  };
  const lost = () => {
    close();
    onLost();
  };
  device.addEventListener('gattserverdisconnected', lost);
  signal.addEventListener('abort', close, { once: true });
  try {
    const server = await gatt.connect();
    active.throwIfAborted();
    const service = await server.getPrimaryService(profile.bleServiceUuid);
    const channel = await service.getCharacteristic(profile.bleCharacteristicUuid);
    await channel.startNotifications();
    active.throwIfAborted();
    return { device, close, request: requestClient(channel, active, lost, protocolVersion, profile) };
  } catch (error) {
    close();
    throw error;
  }
}
