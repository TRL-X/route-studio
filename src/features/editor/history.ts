import { useReducer } from 'react';
import { midpointReference, sameReference } from '../../domain/declination';
import type { MagneticDeclination } from '../../rte/context';
import type { AutomaticDeclination, RouteDocument } from '../../domain/model';
interface History {
  past: RouteDocument[];
  doc: RouteDocument;
  future: RouteDocument[];
}
type Action =
  | { type: 'edit'; doc: RouteDocument }
  | { type: 'replace'; doc: RouteDocument }
  | { type: 'lookup'; settings: AutomaticDeclination; value: MagneticDeclination }
  | { type: 'undo' }
  | { type: 'redo' };
function reduce(h: History, action: Action): History {
  switch (action.type) {
    case 'replace':
      return { doc: action.doc, past: [], future: [] };
    case 'edit':
      return action.doc === h.doc ? h : { past: [...h.past.slice(-59), h.doc], doc: action.doc, future: [] };
    case 'lookup': {
      if (
        h.doc.declination !== action.settings ||
        !sameReference(action.value, midpointReference(h.doc, action.settings.date))
      )
        return h;
      return { ...h, doc: { ...h.doc, declination: { ...action.settings, result: action.value } } };
    }
    case 'undo':
      return h.past.length
        ? { doc: h.past.at(-1)!, past: h.past.slice(0, -1), future: [h.doc, ...h.future] }
        : h;
    case 'redo':
      return h.future.length ? { doc: h.future[0], past: [...h.past, h.doc], future: h.future.slice(1) } : h;
  }
}
export function useHistory(initial: () => RouteDocument) {
  return useReducer(reduce, undefined, () => ({ doc: initial(), past: [], future: [] }));
}
