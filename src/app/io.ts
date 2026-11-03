import type { ExportOptions } from '../rte/processing';
import type { ExportPreview, RteTarget } from '../rte';
import type { Point, RouteDocument } from '../domain/model';
export interface Choice {
  name: string;
  pointCount: number;
  hasUnconfirmedHeights: boolean;
}
export type IORequest =
  | { type: 'read'; file: File; choice?: number; accept?: boolean }
  | { type: 'terrain'; points: Point[] }
  | { type: 'compile'; doc: RouteDocument; options: ExportOptions };
export type IOResult =
  | { type: 'document'; doc: RouteDocument }
  | { type: 'heights'; values: (number | null)[] }
  | { type: 'choices'; choices: Choice[] }
  | { type: 'binary'; bytes: Uint8Array<ArrayBuffer>; preview: ExportPreview }
  | { type: 'error'; en: string; zh: string; fileCode?: string; target?: RteTarget };
export function runIO(request: IORequest, signal?: AbortSignal): Promise<IOResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./io.worker.ts', import.meta.url), { type: 'module' });
    const abort = () => {
      worker.terminate();
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<IOResult>) => {
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = () => {
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      reject(new Error('worker'));
    };
    worker.postMessage(request);
  });
}
