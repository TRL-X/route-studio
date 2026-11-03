import { supportedLookupDate } from '../domain/declination';
import { magneticSource, type RouteDocument } from '../domain/model';
import { validateRteContext, validateDeclination } from '../rte/context';
import { RouteFileError } from './errors';

const format = 'route-studio';
const version = 1;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function position(value: unknown): boolean {
  return (
    record(value) &&
    finite(value.lat) &&
    Math.abs(value.lat) <= 90 &&
    finite(value.lon) &&
    Math.abs(value.lon) <= 180
  );
}

function check(condition: unknown): asserts condition {
  if (!condition) throw new RouteFileError('invalid-project');
}

// Drafts permit missing heights, incomplete stations and even an empty course.
// IDs and anchors must still describe a document that the editor can manipulate.
function validateDocument(value: unknown): asserts value is RouteDocument {
  check(record(value) && typeof value.name === 'string');
  check(value.elevationReference === 0 || value.elevationReference === 1 || value.elevationReference === 2);
  check(Array.isArray(value.vertices) && Array.isArray(value.stations) && Array.isArray(value.elevation));

  const vertices = new Set<string>();
  let lastId: string | undefined;
  for (const vertex of value.vertices) {
    check(record(vertex) && typeof vertex.id === 'string' && vertex.id.length > 0);
    check(position(vertex) && !vertices.has(vertex.id));
    vertices.add(vertex.id);
    lastId = vertex.id;
  }

  function anchor(a: unknown) {
    return (
      record(a) &&
      typeof a.vertexId === 'string' &&
      vertices.has(a.vertexId) &&
      finite(a.fraction) &&
      a.fraction >= 0 &&
      a.fraction <= 1 &&
      (a.vertexId !== lastId || a.fraction === 0)
    );
  }

  for (const sample of value.elevation) {
    check(record(sample) && anchor(sample.anchor) && (sample.height === null || finite(sample.height)));
  }

  const stations = new Set<string>();
  for (const station of value.stations) {
    check(
      record(station) && typeof station.id === 'string' && station.id.length > 0 && !stations.has(station.id),
    );
    stations.add(station.id);
    check(
      typeof station.name === 'string' &&
        (station.shortLabel === undefined || typeof station.shortLabel === 'string'),
    );
    check(
      station.kind === 'start' ||
        station.kind === 'finish' ||
        station.kind === 'cp' ||
        station.kind === 'poi',
    );
    check(typeof station.boundary === 'boolean' && (station.anchor === null || anchor(station.anchor)));
    check(station.location === undefined || position(station.location));
  }
  const settings = value.declination;
  if (settings !== undefined) {
    check(record(settings));
    if (settings.mode === 'auto') {
      check(settings.source === magneticSource && typeof settings.date === 'string');
      if (settings.result !== undefined) {
        try {
          validateDeclination(settings.result);
        } catch {
          throw new RouteFileError('invalid-project');
        }
        check(
          supportedLookupDate(settings.date) &&
            settings.result.referenceDate === settings.date &&
            settings.result.validFrom === undefined &&
            settings.result.validUntil === undefined,
        );
      }
    } else if (settings.mode === 'manual') {
      check([settings.degrees, settings.lat, settings.lon].every((n) => n === null || finite(n)));
      check(
        [settings.date, settings.validFrom, settings.validUntil].every((date) => typeof date === 'string'),
      );
    } else check(settings.mode === 'omit');
  }
  if (value.rte !== undefined) {
    try {
      validateRteContext(value.rte, vertices.size);
    } catch {
      throw new RouteFileError('invalid-project');
    }
  }
}

export function saveProject(doc: RouteDocument): string {
  validateDocument(doc);
  return JSON.stringify({ format, version, document: doc });
}

export function loadProject(text: string): RouteDocument {
  let envelope: unknown;
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new RouteFileError('invalid-project');
  }
  check(record(envelope) && envelope.format === format && Number.isInteger(envelope.version));
  if (envelope.version !== version) throw new RouteFileError('project-version');
  validateDocument(envelope.document);
  return envelope.document;
}
