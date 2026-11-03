import { loadProject, parseRoutes, RouteFileError } from '../files';
import { readRte, prepareRte, RteError } from '../rte';
import type { IORequest, IOResult } from './io';
async function handle(request: IORequest): Promise<IOResult> {
  if (request.type === 'terrain') {
    const { sampleCopernicus } = await import('../files/copernicus');
    const values = await sampleCopernicus(request.points, new AbortController().signal);
    return { type: 'heights', values };
  }
  if (request.type === 'compile') {
    return {
      type: 'binary',
      ...prepareRte(request.doc, request.options),
    };
  }
  const ext = request.file.name.split('.').pop()?.toLowerCase();
  if (ext === 'rte')
    return { type: 'document', doc: readRte(new Uint8Array(await request.file.arrayBuffer())) };
  if (ext === 'routeproj') return { type: 'document', doc: loadProject(await request.file.text()) };
  if (ext !== 'gpx' && ext !== 'kml') throw new RouteFileError('unsupported-format');
  const choices = parseRoutes(await request.file.text(), request.file.name);
  if (request.choice === undefined && (choices.length > 1 || choices[0].hasUnconfirmedHeights)) {
    return {
      type: 'choices',
      choices: choices.map(({ name, pointCount, hasUnconfirmedHeights }) => ({
        name,
        pointCount,
        hasUnconfirmedHeights,
      })),
    };
  }
  return { type: 'document', doc: choices[request.choice ?? 0].open(request.accept) };
}
self.onmessage = async ({ data }: MessageEvent<IORequest>) => {
  try {
    const result = await handle(data);
    self.postMessage(result, { transfer: result.type === 'binary' ? [result.bytes.buffer] : [] });
  } catch (error) {
    const en = error instanceof Error ? error.message : 'File operation failed.';
    const zh = error && typeof error === 'object' && 'messageZh' in error ? String(error.messageZh) : en;
    self.postMessage({
      type: 'error',
      en,
      zh,
      target:
        data.type === 'compile' && error instanceof RteError
          ? (error.target ?? { type: 'route' })
          : undefined,
      fileCode: error instanceof RouteFileError ? error.code : undefined,
    } satisfies IOResult);
  }
};
