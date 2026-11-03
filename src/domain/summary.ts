import type { RouteDocument } from './model';

/** Gaps cannot be interpreted as flat terrain, even when neighboring samples have equal heights. */
export function ascent(doc: RouteDocument): number | null {
  if (!doc.vertices.length || doc.elevation.length < 2 || doc.elevation.some((s) => s.height === null))
    return null;
  const index = new Map(doc.vertices.map((v, i) => [v.id, i]));
  const position = (i: number) =>
    index.get(doc.elevation[i].anchor.vertexId)! + doc.elevation[i].anchor.fraction;
  const samples = doc.elevation
    .map((sample, i) => ({ position: position(i), height: sample.height! }))
    .sort((a, b) => a.position - b.position);
  if (samples[0].position !== 0 || samples.at(-1)!.position !== doc.vertices.length - 1) return null;
  let gain = 0;
  for (let i = 1; i < samples.length; i++) gain += Math.max(0, samples[i].height - samples[i - 1].height);
  return gain;
}
