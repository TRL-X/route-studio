import type { ExportOptions } from '../rte/processing';
import type { ExportPreview, RteTarget } from '../rte';
import type { Point, RouteDocument } from '../domain/model';
import type { FileErrorCode } from '../files/errors';
import type { TrackFormat, TrackExportPreview } from '../files/export';
import type { ImportElevationAssessment } from '../domain/elevation-repair';
export interface Choice {
  name: string;
  pointCount: number;
  hasUnconfirmedHeights: boolean;
}
export type IORequest =
  | { type: 'read'; file: File; choice?: number; accept?: boolean }
  | { type: 'terrain'; points: Point[] }
  | { type: 'export'; doc: RouteDocument; format: TrackFormat }
  | { type: 'compile'; doc: RouteDocument; options: ExportOptions };
export type IOResult =
  | { type: 'document'; doc: RouteDocument; elevationAssessment?: ImportElevationAssessment | null }
  | { type: 'heights'; values: (number | null)[] }
  | { type: 'choices'; choices: Choice[] }
  | { type: 'track-file'; bytes: Uint8Array<ArrayBuffer>; preview: TrackExportPreview }
  | { type: 'binary'; bytes: Uint8Array<ArrayBuffer>; preview: ExportPreview }
  | { type: 'error'; en: string; zh: string; fileCode?: FileErrorCode; target?: RteTarget };
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
