import type { RteTarget } from '../rte';
import type { RouteDocument } from '../domain/model';
export interface Choice {
  name: string;
  pointCount: number;
  hasUnconfirmedHeights: boolean;
}
export type IORequest =
  { type: 'read'; file: File; choice?: number; accept?: boolean } | { type: 'compile'; doc: RouteDocument };
export type IOResult =
  | { type: 'document'; doc: RouteDocument }
  | { type: 'choices'; choices: Choice[] }
  | { type: 'binary'; bytes: Uint8Array<ArrayBuffer> }
  | { type: 'error'; en: string; zh: string; fileCode?: string; target?: RteTarget };
export function runIO(request: IORequest): Promise<IOResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./io.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<IOResult>) => {
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error('worker'));
    };
    worker.postMessage(request);
  });
}
