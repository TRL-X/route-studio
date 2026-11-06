export interface SerialPort extends EventTarget {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number; bufferSize?: number; flowControl?: 'none' | 'hardware' }): Promise<void>;
  close(): Promise<void>;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
  setSignals?(signals: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void>;
}

export interface Serial extends EventTarget {
  requestPort(): Promise<SerialPort>;
}

declare global {
  interface Navigator {
    readonly serial?: Serial;
  }
}
