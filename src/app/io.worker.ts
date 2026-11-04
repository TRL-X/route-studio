import { loadProject, parseRoutes, RouteFileError, type RouteChoice } from '../files';
import { readRte, prepareRte, RteError } from '../rte';
import type { IORequest, IOResult } from './io';
import { assessImportedElevation } from '../domain/elevation-repair';
async function handle(request: IORequest): Promise<IOResult> {
  if (request.type === 'terrain') {
    const { sampleCopernicus } = await import('../files/copernicus');
    const values = await sampleCopernicus(request.points, new AbortController().signal);
    return { type: 'heights', values };
  }
  if (request.type === 'export') {
    const { exportTrack } = await import('../files/export');
    return { type: 'track-file', ...exportTrack(request.doc, request.format) };
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
  let choices: RouteChoice[];
  if (ext === 'fit') {
    const { parseFitRoutes } = await import('../files/fit');
    choices = await parseFitRoutes(await request.file.arrayBuffer(), request.file.name);
  } else if (ext === 'gpx' || ext === 'kml') {
    choices = parseRoutes(await request.file.text(), request.file.name);
  } else {
    throw new RouteFileError('unsupported-format');
  }
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
    if (result.type === 'document') {
      // Keep diagnosis off the UI thread. Oversized projects can still be opened for editing.
      try {
        result.elevationAssessment = assessImportedElevation(result.doc);
      } catch {
        result.elevationAssessment = null;
      }
    }
    self.postMessage(result, {
      transfer: result.type === 'binary' || result.type === 'track-file' ? [result.bytes.buffer] : [],
    });
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
