import { midpointReference, sameReference } from './declination';
import {
  anchorPoint,
  distanceMeters,
  newId,
  type Anchor,
  type Point,
  type RouteDocument,
  type Station,
} from './model';

export function geometryChanged(doc: RouteDocument): RouteDocument {
  if (doc.rte) {
    const rte = { ...doc.rte };
    delete rte.distanceDm;
    delete rte.indexBlockSizes;
    doc = { ...doc, rte };
  }
  const settings = doc.declination;
  if (
    settings?.mode === 'auto' &&
    settings.result &&
    !sameReference(settings.result, midpointReference(doc, settings.date))
  ) {
    return { ...doc, declination: { ...settings, result: undefined } };
  }
  return doc;
}

export function moveVertex(doc: RouteDocument, id: string, point: Point) {
  const i = doc.vertices.findIndex((v) => v.id === id);
  const vertex = doc.vertices[i];
  if (!vertex || (vertex.lat === point.lat && vertex.lon === point.lon)) return doc;
  const vertices = doc.vertices.slice();
  vertices[i] = { ...vertex, ...point };
  return geometryChanged({ ...doc, vertices });
}

function remap(doc: RouteDocument, transform: (a: Anchor) => Anchor) {
  return {
    ...doc,
    elevation: doc.elevation.map((s) => ({ ...s, anchor: transform(s.anchor) })),
    stations: doc.stations.map((s) => (s.anchor ? { ...s, anchor: transform(s.anchor) } : s)),
  };
}

export function appendVertex(doc: RouteDocument, point: Point) {
  const vertex = { id: newId(), ...point };
  const anchor = { vertexId: vertex.id, fraction: 0 };
  const stations = doc.stations.map((s) => (s.kind === 'finish' ? { ...s, anchor } : s));
  if (!doc.vertices.length || (doc.vertices.length === 1 && !stations.some((s) => s.kind === 'finish'))) {
    const kind = doc.vertices.length ? 'finish' : 'start';
    stations.push({ id: newId(), kind, name: kind === 'start' ? 'Start' : 'Finish', boundary: true, anchor });
  }
  return geometryChanged({
    ...doc,
    vertices: [...doc.vertices, vertex],
    stations,
    elevation: [...doc.elevation, { anchor, height: null }],
  });
}

export function insertVertex(doc: RouteDocument, at: Anchor) {
  const i = doc.vertices.findIndex((v) => v.id === at.vertexId);
  if (i < 0 || !doc.vertices[i + 1] || at.fraction <= 0 || at.fraction >= 1) return doc;
  const vertex = { id: newId(), ...anchorPoint(doc, at) };
  const vertices = doc.vertices.slice();
  vertices.splice(i + 1, 0, vertex);
  const mapped = remap(doc, (a) => {
    if (a.vertexId !== at.vertexId) return a;
    return a.fraction < at.fraction
      ? { ...a, fraction: a.fraction / at.fraction }
      : { vertexId: vertex.id, fraction: (a.fraction - at.fraction) / (1 - at.fraction) };
  });
  return geometryChanged({ ...mapped, vertices });
}

export function deleteVertex(doc: RouteDocument, id: string) {
  if (doc.vertices.length <= 2) return doc;
  const i = doc.vertices.findIndex((v) => v.id === id);
  if (i < 0) return doc;
  const previous = doc.vertices[i - 1],
    next = doc.vertices[i + 1];
  const removed = doc.vertices[i];
  const before = previous ? distanceMeters(previous, removed) : 0;
  const after = next ? distanceMeters(removed, next) : 0;
  const ratio = before + after ? before / (before + after) : 0.5;
  // Trimming an endpoint discards the portion of the elevation track outside the new route.
  const elevation = doc.elevation.filter((s) => {
    if (!previous) return s.anchor.vertexId !== id || s.anchor.fraction === 1;
    if (!next)
      return s.anchor.vertexId !== id && !(s.anchor.vertexId === previous.id && s.anchor.fraction > 0);
    return true;
  });
  const result = remap({ ...doc, elevation }, (a) => {
    if (a.vertexId === id) {
      if (!previous) return { vertexId: next.id, fraction: 0 };
      return { vertexId: previous.id, fraction: next ? ratio + (1 - ratio) * a.fraction : 0 };
    }
    return a.vertexId === previous?.id ? { ...a, fraction: next ? a.fraction * ratio : 0 } : a;
  });
  return geometryChanged({ ...result, vertices: doc.vertices.filter((v) => v.id !== id) });
}

export function updateStation(doc: RouteDocument, id: string, patch: Partial<Station>) {
  return { ...doc, stations: doc.stations.map((s) => (s.id === id ? { ...s, ...patch } : s)) };
}
