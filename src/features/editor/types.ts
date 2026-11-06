export type Selection =
  { type: 'route' } | { type: 'vertex' | 'station'; id: string } | { type: 'sample'; index: number };
export type Tool = 'select' | 'append' | 'insert' | 'newStation' | 'stationAnchor' | 'stationLocation';

export function sameTarget(a: Selection, b?: Selection) {
  if (a.type === 'route') return b?.type === 'route';
  if (a.type === 'sample') return b?.type === 'sample' && a.index === b.index;
  return a.type === b?.type && a.id === b.id;
}
