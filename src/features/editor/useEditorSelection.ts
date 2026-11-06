import { useEffect, useMemo, useState } from 'react';
import { appendVertex, deleteVertex, insertVertex, moveVertex, updateStation } from '../../domain/edit';
import {
  anchorDistance,
  distances,
  newId,
  type Anchor,
  type Point,
  type RouteDocument,
} from '../../domain/model';
import { both, strings, type Lang, type Localized } from '../../i18n';
import type { Selection, Tool } from './types';

export function useEditorSelection({
  doc,
  lang,
  locked,
  change,
  setNotice,
}: {
  doc: RouteDocument;
  lang: Lang;
  locked: boolean;
  change: (next: RouteDocument) => void;
  setNotice: (notice: Localized | null) => void;
}) {
  const t = strings[lang];
  const [selected, choose] = useState<Selection>({ type: 'route' });
  const [revealSelection, setRevealSelection] = useState(0);
  const [tool, setTool] = useState<Tool>('select');
  const [hoveredSample, setHoveredSample] = useState<number | null>(null);
  const [mapProbeDistance, setMapProbeDistance] = useState<number | null>(null);
  const [panel, setPanel] = useState<'outline' | 'inspector' | null>(null);
  const [viewCommand, setViewCommand] = useState<{ type: 'fit' | 'zoomIn' | 'zoomOut'; nonce: number }>();
  const axis = useMemo(() => distances(doc.vertices), [doc.vertices]);
  const activeStation =
    selected.type === 'station' ? doc.stations.find((s) => s.id === selected.id) : undefined;
  const focus = useMemo(
    () =>
      selected.type === 'station'
        ? activeStation?.anchor
        : selected.type === 'vertex'
          ? { vertexId: selected.id, fraction: 0 }
          : selected.type === 'sample'
            ? doc.elevation[selected.index]?.anchor
            : null,
    [selected, activeStation, doc.elevation],
  );
  const focusedMeters = useMemo(() => (focus ? anchorDistance(doc, focus, axis) : null), [axis, focus]);
  let selectionTitle = t.details;
  if (activeStation) selectionTitle = activeStation.name || t[activeStation.kind];
  if (selected.type === 'sample') selectionTitle = t.sample + ' ' + (selected.index + 1);
  if (selected.type === 'vertex') selectionTitle = t.vertex;
  const select = (s: Selection, inspect = false) => {
    choose(s);
    setNotice(null);
    setRevealSelection((n) => n + 1);
    setTool('select');
    setPanel(inspect ? 'inspector' : null);
  };
  function addStation() {
    if (doc.vertices.length < 2) {
      setNotice(both('noVertices'));
      return;
    }
    setPanel(null);
    setTool('newStation');
    setNotice(null);
  }
  function pickAnchor(a: Anchor) {
    if (tool === 'insert') {
      const next = insertVertex(doc, a);
      if (next === doc) {
        setNotice(both('invalidInsert'));
        return;
      }
      const i = doc.vertices.findIndex((vertex) => vertex.id === a.vertexId);
      change(next);
      select({ type: 'vertex', id: next.vertices[i + 1].id }, true);
    } else if (tool === 'newStation') {
      const id = newId();
      change({
        ...doc,
        stations: [...doc.stations, { id, name: t.newStation, kind: 'cp', boundary: true, anchor: a }],
      });
      select({ type: 'station', id }, true);
      setNotice(both('stationAdded'));
    } else if (tool === 'stationAnchor' && activeStation) {
      change(updateStation(doc, activeStation.id, { anchor: a }));
      select({ type: 'station', id: activeStation.id }, true);
    }
  }
  function cancelTool() {
    setTool('select');
    setNotice(null);
    setPanel(selected.type === 'route' ? null : 'inspector');
  }
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (
        locked ||
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        (event.target instanceof Element &&
          event.target.closest('[role="dialog"], [role="menu"], [role="listbox"]'))
      )
        return;
      if (tool !== 'select') cancelTool();
      else setPanel(null);
    };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, [locked, tool, selected]);
  const canDelete =
    selected.type === 'vertex'
      ? doc.vertices.length > 2
      : selected.type === 'sample'
        ? !!doc.elevation[selected.index]
        : selected.type === 'station'
          ? !!activeStation && !['start', 'finish'].includes(activeStation.kind)
          : false;
  function deleteSelected() {
    if (!canDelete) return;
    if (selected.type === 'vertex') change(deleteVertex(doc, selected.id));
    else if (selected.type === 'sample')
      change({ ...doc, elevation: doc.elevation.filter((_, i) => i !== selected.index) });
    else if (selected.type === 'station')
      change({ ...doc, stations: doc.stations.filter((s) => s.id !== selected.id) });
    select({ type: 'route' }, true);
  }
  function startTool(next: Tool) {
    if ((next === 'insert' || next === 'newStation') && doc.vertices.length < 2) return;
    if (next === 'select') {
      cancelTool();
      return;
    }
    if (next === 'newStation') {
      addStation();
      return;
    }
    setTool(next);
    setPanel(null);
    setNotice(null);
  }
  const mapCommand = (type: 'fit' | 'zoomIn' | 'zoomOut') =>
    setViewCommand((previous) => ({ type, nonce: (previous?.nonce ?? 0) + 1 }));
  const toolHelp = {
    select: t.editing,
    append: t.drawing,
    insert: t.inserting,
    newStation: t.placing,
    stationAnchor: t.placing,
    stationLocation: t.locating,
  }[tool];
  function reconcile(next: RouteDocument) {
    if (
      (selected.type === 'station' && !next.stations.some((s) => s.id === selected.id)) ||
      (selected.type === 'vertex' && !next.vertices.some((v) => v.id === selected.id)) ||
      (selected.type === 'sample' && !next.elevation[selected.index])
    ) {
      choose({ type: 'route' });
      setPanel(null);
    }
    setTool('select');
  }
  function addVertex(point: Point) {
    const next = appendVertex(doc, point);
    change(next);
    choose({ type: 'vertex', id: next.vertices.at(-1)!.id });
  }
  function relocateVertex(id: string, point: Point) {
    change(moveVertex(doc, id, point));
  }
  function pickLocation(point: Point) {
    if (activeStation) {
      change(updateStation(doc, activeStation.id, { location: point }));
      select({ type: 'station', id: activeStation.id }, true);
    }
  }
  return {
    selected,
    revealSelection,
    tool,
    hoveredSample,
    setHoveredSample,
    mapProbeDistance,
    setMapProbeDistance,
    panel,
    setPanel,
    viewCommand,
    axis,
    activeStation,
    focus,
    focusedMeters,
    selectionTitle,
    select,
    addStation,
    pickAnchor,
    cancelTool,
    canDelete,
    deleteSelected,
    startTool,
    mapCommand,
    toolHelp,
    reconcile,
    addVertex,
    moveVertex: relocateVertex,
    pickLocation,
  };
}
export type EditorSelection = ReturnType<typeof useEditorSelection>;
