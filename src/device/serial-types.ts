export interface SerialPort extends EventTarget {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  open(options: {
    baudRate: number;
    bufferSize?: number;
    flowControl?: 'none' | 'hardware';
    dataBits?: 7 | 8;
    stopBits?: 1 | 2;
    parity?: 'none' | 'even' | 'odd';
  }): Promise<void>;
  close(): Promise<void>;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
  setSignals?(signals: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void>;
}

export interface Serial extends EventTarget {
  requestPort(options?: { filters?: { usbVendorId: number; usbProductId?: number }[] }): Promise<SerialPort>;
}

declare global {
  interface Navigator {
    readonly serial?: Serial;
  }
}
