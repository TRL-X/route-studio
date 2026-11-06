import type { IORequest, IOResult } from './contracts';
export type { Choice, IORequest, IOResult } from './contracts';

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
