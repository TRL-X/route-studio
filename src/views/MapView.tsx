import { IconButton, Card, Flex } from '@radix-ui/themes';
import { Maximize, Minus, Plus } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Map as LibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { anchorPoint, lonDelta } from '../domain/model';
import type { Anchor, RouteDocument, Station } from '../domain/model';
import { orderedStations, stationPassages, type StationPassage } from '../domain/projection';
import type { Tool } from '../app/Inspector';
import { StationPassOptions } from '../app/StationPassOptions';
import { strings, type Lang } from '../app/strings';
import {
  basemapStyle,
  classifyBasemapFailure,
  type BasemapFailure,
  type BasemapPreferences,
} from '../maps/basemap';
import type { ColorScheme } from '../app/theme';
import { BasemapControls } from './BasemapControls';
import { StationSymbol } from './StationSymbol';
import './views.css';

type Point = { lat: number; lon: number };
type XY = { x: number; y: number };
type Camera = XY & { zoom: number };
interface MapViewProps {
  doc: RouteDocument;
  lang: Lang;
  scheme: ColorScheme;
  basemap: BasemapPreferences;
  storageFailed: boolean;
  onOpenSettings: () => void;
  viewCommand?: { type: 'fit' | 'zoomIn' | 'zoomOut'; nonce: number };
  tool: Tool;
  axis: number[];
  revealSelection: number;
  selectedVertexId: string | null;
  selectedStationId: string | null;
  focusAnchor?: Anchor | null;
  profileHoverAnchor?: Anchor | null;
  onProbeDistance?: (meters: number | null) => void;
  onSelectVertex: (id: string) => void;
  onSelectStation: (id: string) => void;
  onMoveVertex: (id: string, point: Point) => void;
  onAddVertex: (point: Point) => void;
  onPickAnchor: (anchor: Anchor) => void;
  onPickLocation: (point: Point) => void;
}

const radians = Math.PI / 180;
const scaleAt = (zoom: number) => 512 * 2 ** zoom;
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(n, high));
const wrap = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;
const snapRadius = 12; // CSS pixels, independent of zoom and display pixel density.
type Snap = XY & { anchor: Anchor; meters: number };
type MapStation = {
  station: Station;
  anchor: XY | null;
  location: XY | null;
  marker: XY;
  name: string;
  chosen: boolean;
  label?: XY & { side: 'start' | 'end' };
};

function snapToRoute(cursor: XY, screen: (XY & { id: string })[], axis: number[]): Snap | null {
  let hit: Snap | null = null;
  let best = snapRadius ** 2;
  for (let i = 1; i < screen.length; i++) {
    const a = screen[i - 1],
      b = screen[i];
    if (
      cursor.x < Math.min(a.x, b.x) - snapRadius ||
      cursor.x > Math.max(a.x, b.x) + snapRadius ||
      cursor.y < Math.min(a.y, b.y) - snapRadius ||
      cursor.y > Math.max(a.y, b.y) + snapRadius
    )
      continue;
    const dx = b.x - a.x,
      dy = b.y - a.y,
      length2 = dx * dx + dy * dy;
    const fraction = length2 ? clamp(((cursor.x - a.x) * dx + (cursor.y - a.y) * dy) / length2, 0, 1) : 0;
    const x = a.x + fraction * dx,
      y = a.y + fraction * dy;
    const d2 = (x - cursor.x) ** 2 + (y - cursor.y) ** 2;
    if (d2 > best || (hit && d2 === best)) continue;
    best = d2;
    hit = {
      x,
      y,
      anchor: fraction === 1 ? { vertexId: b.id, fraction: 0 } : { vertexId: a.id, fraction },
      meters: axis[i - 1] + (axis[i] - axis[i - 1]) * fraction,
    };
  }
  return hit;
}

function project(point: Point): XY {
  const φ = clamp(point.lat, -85.051129, 85.051129) * radians;
  return { x: (point.lon + 180) / 360, y: (1 - Math.asinh(Math.tan(φ)) / Math.PI) / 2 };
}
function unproject({ x, y }: XY): Point {
  return {
    lon: wrap(x * 360 - 180),
    lat: Math.atan(Math.sinh((1 - 2 * clamp(y, 0, 1)) * Math.PI)) / radians,
  };
}
function niceStep(value: number) {
  const multiple = 10 ** Math.floor(Math.log10(Math.max(1e-10, value)));
  return ([1, 2, 5, 10].find((factor) => factor * multiple >= value) ?? 10) * multiple;
}
function fitted(points: XY[], width: number, height: number): Camera {
  if (!points.length) return { ...project({ lat: 20, lon: 0 }), zoom: 1 };
  let left = points[0].x,
    right = left,
    top = points[0].y,
    bottom = top;
  for (const p of points) {
    left = Math.min(left, p.x);
    right = Math.max(right, p.x);
    top = Math.min(top, p.y);
    bottom = Math.max(bottom, p.y);
  }
  const scale = Math.min(
    Math.max(40, width - 120) / (right - left),
    Math.max(40, height - 112) / (bottom - top),
  );
  return { x: (left + right) / 2, y: (top + bottom) / 2, zoom: clamp(Math.log2(scale / 512), 0, 16) };
}

// The editor owns its 2D camera. A basemap is an optional underlay using the same
// Mercator camera, so edits and hit testing also work without a network or GPU.
function Basemap({
  camera,
  scheme,
  preferences,
  onFailure,
}: {
  camera: Camera;
  scheme: ColorScheme;
  preferences: BasemapPreferences;
  onFailure: (reason: BasemapFailure) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const customDarkStyle =
    preferences.provider === 'openfreemap' && scheme === 'dark'
      ? import.meta.env.VITE_MAP_DARK_STYLE_URL
      : undefined;
  const instance = useRef<LibreMap | null>(null);
  const latestCamera = useRef(camera);
  const failure = useRef(onFailure);
  latestCamera.current = camera;
  failure.current = onFailure;
  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | undefined;
    const fail = (reason: BasemapFailure) => {
      if (!cancelled) failure.current(reason);
    };
    const timeout = setTimeout(() => fail('timeout'), 20000);
    (async () => {
      const [{ Map, setWorkerUrl }, worker] = await Promise.all([
        import('maplibre-gl'),
        import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'),
      ]);
      if (cancelled || !host.current) return;
      setWorkerUrl(worker.default);
      const first = latestCamera.current;
      const map = new Map({
        container: host.current,
        style: customDarkStyle || basemapStyle(preferences),
        interactive: false,
        center: [first.x * 360 - 180, unproject(first).lat],
        zoom: first.zoom,
        canvasContextAttributes: { antialias: false },
        attributionControl: { compact: true },
      });
      instance.current = map;
      map.once('load', () => clearTimeout(timeout));
      map.on('error', ({ error }) => {
        // Inline raster styles can load before their tiles fail. Handle tile errors too,
        // and never surface the raw error URL, which may contain the user's Key.
        fail(classifyBasemapFailure(error));
      });
      map.on('webglcontextlost', () => {
        fail('graphics');
      });
      observer = new ResizeObserver(() => map.resize());
      observer.observe(host.current);
    })().catch(() => {
      fail('unavailable');
    });
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      observer?.disconnect();
      instance.current?.remove();
      instance.current = null;
    };
  }, [preferences.provider, preferences.tiandituKey, customDarkStyle]);
  useEffect(() => {
    instance.current?.jumpTo({ center: [camera.x * 360 - 180, unproject(camera).lat], zoom: camera.zoom });
  }, [camera]);
  return <div className="rv-base" ref={host} />;
}

export function MapView(props: MapViewProps) {
  const { doc, lang, tool, selectedVertexId, selectedStationId, basemap } = props;
  const t = strings[lang];
  const container = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 800, height: 450 });
  const [manualCamera, setCamera] = useState<Camera | null>(null);
  const [baseFailure, setBaseFailure] = useState<BasemapFailure | null>(null);
  const [baseAttempt, setBaseAttempt] = useState(0);
  const missingBaseKey = basemap.provider === 'tianditu' && !basemap.tiandituKey;
  const showBase = basemap.enabled && !baseFailure && !missingBaseKey;
  const retryBase = () => {
    setBaseFailure(null);
    setBaseAttempt((attempt) => attempt + 1);
  };
  useEffect(() => {
    setBaseFailure(null);
  }, [basemap.provider, basemap.tiandituKey, basemap.enabled]);
  const [hover, setHover] = useState<(XY & { onRoute: boolean }) | null>(null);
  const [mapProbe, setMapProbe] = useState<(XY & { meters: number }) | null>(null);
  const [passes, setPasses] = useState<StationPassage[] | null>(null);
  const passPanel = useRef<HTMLDivElement>(null);
  useEffect(() => setPasses(null), [tool, doc.vertices, selectedStationId]);
  useEffect(() => setMapProbe(null), [tool, doc.vertices, manualCamera, size]);
  const probeDistance = tool === 'select' ? (mapProbe?.meters ?? null) : null;
  useEffect(() => props.onProbeDistance?.(probeDistance), [props.onProbeDistance, probeDistance]);
  useEffect(() => {
    if (passes) passPanel.current?.querySelector('button')?.focus();
  }, [passes]);
  const [preview, setPreview] = useState<{ id: string; p: XY } | null>(null);
  const drag = useRef<{
    start: XY;
    camera: Camera;
    vertex?: string;
    station?: string;
    moved: boolean;
    pan: boolean;
  } | null>(null);
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => {
      if (element.clientWidth && element.clientHeight)
        setSize({ width: element.clientWidth, height: element.clientHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const world = useMemo(() => {
    let previousX = 0;
    return doc.vertices.map((vertex, i) => {
      const p = project(vertex);
      if (i) p.x = previousX + lonDelta(doc.vertices[i - 1].lon, vertex.lon) / 360;
      previousX = p.x;
      return { ...p, id: vertex.id };
    });
  }, [doc.vertices]);
  const vertexIndices = useMemo(() => new Map(doc.vertices.map((v, i) => [v.id, i])), [doc.vertices]);
  const [textMeasure] = useState(() => document.createElement('canvas').getContext('2d'));
  const fit = useMemo(() => fitted(world, size.width, size.height), [world, size]);
  const camera = manualCamera ?? fit;
  const scale = scaleAt(camera.zoom);
  const toScreen = (p: XY): XY => ({
    x: (p.x - camera.x) * scale + size.width / 2,
    y: (p.y - camera.y) * scale + size.height / 2,
  });
  const screenPoint = (p: Point) => {
    const w = project(p);
    w.x += Math.round(camera.x - w.x);
    return toScreen(w);
  };
  const toWorld = (p: XY): XY => ({
    x: camera.x + (p.x - size.width / 2) / scale,
    y: camera.y + (p.y - size.height / 2) / scale,
  });
  const mapStations = useMemo(() => {
    const markers: MapStation[] = [];
    doc.stations.forEach((station, i) => {
      const anchor = station.anchor ? screenPoint(anchorPoint(doc, station.anchor, vertexIndices)) : null;
      const location = station.location ? screenPoint(station.location) : null;
      const marker = anchor ?? location;
      if (!marker) return;
      const chosen = station.id === selectedStationId;
      const name = (chosen && station.name) || station.shortLabel || station.name || String(i + 1);
      markers.push({ station, anchor, location, marker, name, chosen });
    });
    // Reserve the selected label first and paint its symbol last so it remains visible on a shared pass.
    markers.sort((a, b) => Number(a.chosen) - Number(b.chosen));
    const occupied: { left: number; right: number; top: number; bottom: number }[] = [];
    if (textMeasure) textMeasure.font = '600 12px system-ui, sans-serif';
    for (let i = markers.length - 1; i >= 0; i--) {
      const item = markers[i];
      const width = (textMeasure?.measureText(item.name).width ?? item.name.length * 12) + 4;
      for (const offsetY of [-8, 18]) {
        for (const side of ['start', 'end'] as const) {
          const x = item.marker.x + (side === 'start' ? 10 : -10),
            y = item.marker.y + offsetY;
          const left = side === 'start' ? x : x - width,
            right = left + width,
            top = y - 12,
            bottom = y + 3;
          if (left < 2 || right > size.width - 2 || top < 2 || bottom > size.height - 2) continue;
          if (occupied.some((b) => b.left < right && b.right > left && b.top < bottom && b.bottom > top))
            continue;
          item.label = { x, y, side };
          occupied.push({ left, right, top, bottom });
          break;
        }
        if (item.label) break;
      }
    }
    return markers;
  }, [doc.stations, vertexIndices, selectedStationId, camera, size, textMeasure]);
  const here = (ev: ReactPointerEvent<SVGSVGElement>): XY => {
    const rect = ev.currentTarget.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  };
  function zoomBy(delta: number, at: XY = { x: size.width / 2, y: size.height / 2 }) {
    const zoom = clamp(camera.zoom + delta, 0, 21);
    const correction = 1 / scale - 1 / scaleAt(zoom);
    setCamera({
      x: camera.x + (at.x - size.width / 2) * correction,
      y: clamp(camera.y + (at.y - size.height / 2) * correction, 0, 1),
      zoom,
    });
  }
  const lastViewCommand = useRef(props.viewCommand?.nonce);
  useEffect(() => {
    const command = props.viewCommand;
    if (!command || command.nonce === lastViewCommand.current) return;
    lastViewCommand.current = command.nonce;
    if (command.type === 'fit') setCamera(null);
    else zoomBy(command.type === 'zoomIn' ? 1 : -1);
  }, [props.viewCommand]);
  const wheel = useRef(zoomBy);
  wheel.current = zoomBy;
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const rect = element.getBoundingClientRect();
      wheel.current(clamp(-ev.deltaY * (ev.deltaMode === 1 ? 0.2 : 0.0035), -2, 2), {
        x: ev.clientX - rect.left,
        y: ev.clientY - rect.top,
      });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  const screen = useMemo(
    () =>
      world.map((p) => {
        const active = preview && p.id === preview.id ? preview.p : p;
        return {
          id: p.id,
          x: (active.x - camera.x) * scale + size.width / 2,
          y: (active.y - camera.y) * scale + size.height / 2,
        };
      }),
    [world, preview, camera, scale, size],
  );
  const { routePath, handles } = useMemo(() => {
    let routePath = '',
      last: XY | undefined;
    const handles = [];
    let lastHandle: XY | undefined;
    for (let i = 0; i < screen.length; i++) {
      const p = screen[i],
        end = i === screen.length - 1;
      if (!last || end || Math.abs(p.x - last.x) + Math.abs(p.y - last.y) > 0.9) {
        routePath += (last ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1);
        last = p;
      }
      if (p.x < -8 || p.x > size.width + 8 || p.y < -8 || p.y > size.height + 8) continue;
      if (!lastHandle || end || Math.hypot(p.x - lastHandle.x, p.y - lastHandle.y) >= 24) {
        handles.push(p);
        lastHandle = p;
      }
    }
    return { routePath, handles };
  }, [screen, size]);
  const activeVertex = selectedVertexId ? screen[vertexIndices.get(selectedVertexId)!] : undefined;
  const focusPoint = props.focusAnchor
    ? screenPoint(anchorPoint(doc, props.focusAnchor, vertexIndices))
    : null;
  const hoverPoint = props.profileHoverAnchor
    ? screenPoint(anchorPoint(doc, props.profileHoverAnchor, vertexIndices))
    : null;
  const snapping = tool === 'newStation' || tool === 'stationAnchor' || tool === 'insert';
  const snap = useMemo(
    () => (snapping && hover?.onRoute && !passes ? snapToRoute(hover, screen, props.axis) : null),
    [snapping, hover, passes, screen, props.axis],
  );
  const selectedStation = selectedStationId
    ? doc.stations.find((s) => s.id === selectedStationId)
    : undefined;
  const selectedPosition = selectedStation?.anchor
    ? anchorPoint(doc, selectedStation.anchor, vertexIndices)
    : (selectedStation?.location ??
      (selectedVertexId ? doc.vertices[vertexIndices.get(selectedVertexId)!] : undefined) ??
      (props.focusAnchor && anchorPoint(doc, props.focusAnchor, vertexIndices)));
  const selectionKey = selectedPosition
    ? [props.revealSelection, selectedPosition.lon, selectedPosition.lat].join('/')
    : '';
  const previousSelection = useRef('');
  useLayoutEffect(() => {
    if (selectionKey === previousSelection.current) return;
    previousSelection.current = selectionKey;
    if (!selectedPosition || tool !== 'select') return;
    const target = project(selectedPosition);
    target.x += Math.round(camera.x - target.x);
    const p = toScreen(target);
    if (p.x < 8 || p.x > size.width - 8 || p.y < 8 || p.y > size.height - 8)
      setCamera({ ...target, zoom: camera.zoom });
  });
  function hitVertex(p: XY) {
    let bestId: string | undefined;
    let best = 8 ** 2;
    for (const v of screen) {
      const d = (v.x - p.x) ** 2 + (v.y - p.y) ** 2;
      if (d < best) {
        best = d;
        bestId = v.id;
      }
    }
    return bestId;
  }
  function pointerDown(ev: ReactPointerEvent<SVGSVGElement>) {
    if (ev.button !== 0 && ev.button !== 1) return;
    ev.preventDefault();
    ev.currentTarget.focus();
    const start = here(ev);
    setMapProbe(null);
    const pan = ev.button === 1;
    const station =
      !pan && tool === 'select'
        ? ((ev.target as Element).closest('[data-station]')?.getAttribute('data-station') ?? undefined)
        : undefined;
    // Endpoint stations share a vertex. A click selects the station but a drag
    // at the same position must still be able to move the underlying vertex.
    const vertex = !pan && tool === 'select' ? hitVertex(start) : undefined;
    drag.current = { start, camera, vertex, station, moved: false, pan };
    ev.currentTarget.setPointerCapture(ev.pointerId);
  }
  function pointerMove(ev: ReactPointerEvent<SVGSVGElement>) {
    const p = here(ev);
    const target = ev.target as Element;
    const stationId = target.closest('[data-station]')?.getAttribute('data-station');
    const onRoute = !!stationId || target.matches('.rv-route-hit, .rv-active-vertex');
    setHover({ ...p, onRoute });
    const d = drag.current;
    if (!d && tool === 'select' && onRoute) {
      const station = stationId ? doc.stations.find((s) => s.id === stationId) : undefined;
      if (station?.anchor) {
        const { vertexId, fraction } = station.anchor;
        const i = vertexIndices.get(vertexId)!;
        const meters = props.axis[i] + ((props.axis[i + 1] ?? props.axis[i]) - props.axis[i]) * fraction;
        setMapProbe({ ...screenPoint(anchorPoint(doc, station.anchor, vertexIndices)), meters });
      } else {
        setMapProbe(snapToRoute(p, screen, props.axis));
      }
    } else setMapProbe(null);
    if (!d) return;
    const dx = p.x - d.start.x,
      dy = p.y - d.start.y;
    if (Math.hypot(dx, dy) > 3) d.moved = true;
    if (!d.moved) return;
    if (d.vertex) setPreview({ id: d.vertex, p: toWorld(p) });
    else
      setCamera({
        ...d.camera,
        x: d.camera.x - dx / scaleAt(d.camera.zoom),
        y: clamp(d.camera.y - dy / scaleAt(d.camera.zoom), 0, 1),
      });
  }
  function pointerUp(ev: ReactPointerEvent<SVGSVGElement>) {
    const d = drag.current;
    drag.current = null;
    setPreview(null);
    if (ev.currentTarget.hasPointerCapture(ev.pointerId))
      ev.currentTarget.releasePointerCapture(ev.pointerId);
    if (!d || d.pan) return;
    const cursor = here(ev);
    const point = unproject(toWorld(cursor));
    if (d.moved) {
      if (d.vertex) {
        setCamera(d.camera);
        props.onSelectVertex(d.vertex);
        props.onMoveVertex(d.vertex, point);
      }
      return;
    }
    if (tool === 'append') {
      setCamera(camera);
      props.onAddVertex(point);
    } else if (tool === 'stationLocation') props.onPickLocation(point);
    else if (snapping) {
      const hit = snapToRoute(cursor, screen, props.axis);
      setPasses(null);
      if (!hit) return;
      if (tool !== 'insert') {
        const candidates = stationPassages(
          doc,
          anchorPoint(doc, hit.anchor, vertexIndices),
          props.axis,
        ).filter(({ anchor }) => {
          const p = screenPoint(anchorPoint(doc, anchor, vertexIndices));
          return Math.hypot(p.x - cursor.x, p.y - cursor.y) <= snapRadius;
        });
        if (candidates.length > 1) {
          setPasses(candidates);
          return;
        }
      }
      props.onPickAnchor(hit.anchor);
    } else if (d.station) props.onSelectStation(d.station);
    else if (d.vertex) props.onSelectVertex(d.vertex);
  }

  const center = unproject(camera);
  const stepX = niceStep((110 * 360) / scale),
    stepY = niceStep((80 * 360 * Math.cos(center.lat * radians)) / scale);
  const lon0 = camera.x * 360 - 180 - (size.width * 180) / scale;
  const lat0 = unproject(toWorld({ x: 0, y: size.height })).lat,
    lat1 = unproject(toWorld({ x: 0, y: 0 })).lat;
  const grid = [];
  const format = (n: number, step: number) => n.toFixed(Math.max(0, Math.ceil(-Math.log10(step))));
  let lastLabelEnd = 0;
  for (
    let lon = Math.ceil(lon0 / stepX) * stepX;
    lon <= lon0 + (size.width * 360) / scale + 1e-10;
    lon += stepX
  ) {
    const x = toScreen({ x: (lon + 180) / 360, y: 0 }).x;
    const label = format(wrap(lon), stepX) + '°';
    const labelWidth = label.length * 8; // Allow for each glyph of the 12px monospace grid font.
    const alignEnd = x + 5 + labelWidth > size.width - 4;
    const labelX = alignEnd ? x - 5 : x + 5;
    const left = alignEnd ? labelX - labelWidth : labelX;
    const fits = left >= lastLabelEnd + 4;
    if (fits) lastLabelEnd = left + labelWidth;
    grid.push(
      <g key={'x' + lon}>
        <path d={'M' + x + ' 0v' + size.height} />
        {fits && (
          <text x={labelX} y="14" textAnchor={alignEnd ? 'end' : 'start'}>
            {label}
          </text>
        )}
      </g>,
    );
  }
  for (let lat = Math.ceil(lat0 / stepY) * stepY; lat <= lat1 + 1e-10; lat += stepY) {
    const y = toScreen(project({ lat, lon: 0 })).y;
    // The left edge is shared with the basemap button above and the scale below.
    const fits = y >= 70 && y <= size.height - 30;
    grid.push(
      <g key={'y' + lat}>
        <path d={'M0 ' + y + 'h' + size.width} />
        {fits && (
          <text x="7" y={y - 4}>
            {format(lat, stepY)}°
          </text>
        )}
      </g>,
    );
  }

  const metresPerPixel = (40075016.69 * Math.cos(center.lat * radians)) / scale;
  const scaleMetres = niceStep(40 * metresPerPixel);
  const displayPos = hover ? unproject(toWorld(hover)) : center;
  return (
    <div
      className={
        'rv-map' +
        (showBase ? ' rv-has-base' : '') +
        (showBase &&
        (basemap.provider === 'tianditu' ||
          ((props.scheme === 'dark' && import.meta.env.VITE_MAP_DARK_STYLE_URL) || basemapStyle(basemap)) ===
            'https://tiles.openfreemap.org/styles/liberty')
          ? ' rv-colored-base'
          : '')
      }
      ref={container}
    >
      {showBase && (
        <Basemap
          scheme={props.scheme}
          key={baseAttempt}
          camera={camera}
          preferences={basemap}
          onFailure={setBaseFailure}
        />
      )}
      <svg
        ref={svg}
        viewBox={'0 0 ' + size.width + ' ' + size.height}
        className={'rv-map-svg rv-tool-' + tool}
        role="application"
        aria-label={t.routeMap}
        tabIndex={0}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerLeave={() => {
          setHover(null);
          setMapProbe(null);
        }}
        onLostPointerCapture={() => {
          drag.current = null;
          setPreview(null);
        }}
        onKeyDown={(ev) => {
          const delta = 70 / scale;
          if (ev.key === '+' || ev.key === '=') zoomBy(1);
          else if (ev.key === '-') zoomBy(-1);
          else if (ev.key === 'Home') setCamera(null);
          else if (ev.key.startsWith('Arrow'))
            setCamera({
              ...camera,
              x: camera.x + (ev.key === 'ArrowLeft' ? -delta : ev.key === 'ArrowRight' ? delta : 0),
              y: clamp(camera.y + (ev.key === 'ArrowUp' ? -delta : ev.key === 'ArrowDown' ? delta : 0), 0, 1),
            });
          else return;
          ev.preventDefault();
          ev.stopPropagation();
        }}
      >
        {!showBase && <g className="rv-graticule">{grid}</g>}
        <path className="rv-route-halo" d={routePath} />
        <path className="rv-route" d={routePath} />
        <path className="rv-route-hit" d={routePath} strokeWidth={snapRadius * 2} />
        {handles.map((p) => (
          <circle className="rv-vertex" key={p.id} cx={p.x} cy={p.y} r={2.4} />
        ))}
        {mapStations.map(({ station, anchor, location, marker, chosen, name, label }) => {
          return (
            <g
              key={station.id}
              data-station={station.id}
              data-kind={station.kind}
              className={'rv-station' + (chosen ? ' rv-station-active' : '')}
            >
              <title>{station.name || name}</title>
              {location && anchor && Math.hypot(anchor.x - location.x, anchor.y - location.y) > 8 && (
                <>
                  <line
                    className="rv-connector"
                    x1={anchor.x}
                    y1={anchor.y}
                    x2={location.x}
                    y2={location.y}
                  />
                  <circle className="rv-actual" cx={location.x} cy={location.y} r={4} />
                </>
              )}
              <circle className="rv-station-hit" cx={marker.x} cy={marker.y} r={10} />
              <StationSymbol
                className="rv-station-halo"
                kind={station.kind}
                boundary={station.boundary}
                {...marker}
              />
              {chosen && <circle className="rv-selection-ring" cx={marker.x} cy={marker.y} r={9} />}
              <StationSymbol
                className="rv-station-pin"
                kind={station.kind}
                boundary={station.boundary}
                {...marker}
              />
              {label && (
                <text x={label.x} y={label.y} textAnchor={label.side}>
                  {name}
                </text>
              )}
            </g>
          );
        })}
        {activeVertex && (
          <circle className="rv-active-vertex" cx={activeVertex.x} cy={activeVertex.y} r={5} />
        )}
        {focusPoint && <circle className="rv-anchor-focus" cx={focusPoint.x} cy={focusPoint.y} r={7} />}
        {hoverPoint && <circle className="rv-anchor-hover" cx={hoverPoint.x} cy={hoverPoint.y} r={11} />}
        {tool === 'select' && mapProbe && (
          <circle className="rv-anchor-hover" cx={mapProbe.x} cy={mapProbe.y} r={11} />
        )}
        {snap && (
          <g className="rv-snap-preview">
            <circle cx={snap.x} cy={snap.y} r={6} />
            <text
              x={snap.x + (snap.x > size.width - 90 ? -10 : 10)}
              y={snap.y < 26 ? snap.y + 20 : snap.y - 11}
              textAnchor={snap.x > size.width - 90 ? 'end' : 'start'}
            >
              {(snap.meters / 1000).toFixed(3)} km
            </text>
          </g>
        )}
      </svg>
      {snapping && passes && (
        <Card className="rv-pass-panel" ref={passPanel}>
          <StationPassOptions
            candidates={passes}
            positions={orderedStations(doc, props.axis)}
            stationId={tool === 'stationAnchor' ? (selectedStationId ?? undefined) : undefined}
            title={t.choosePass}
            t={t}
            onPick={props.onPickAnchor}
          />
        </Card>
      )}
      <Card className="rv-zoom" aria-label={t.mapView} size="1">
        <Flex direction="column" gap="1">
          <IconButton
            variant="soft"
            color="gray"
            type="button"
            aria-label={t.zoomIn}
            title={t.zoomIn}
            onClick={() => zoomBy(1)}
          >
            <Plus />
          </IconButton>
          <IconButton
            variant="soft"
            color="gray"
            type="button"
            aria-label={t.zoomOut}
            title={t.zoomOut}
            onClick={() => zoomBy(-1)}
          >
            <Minus />
          </IconButton>
          <IconButton
            variant="soft"
            color="gray"
            type="button"
            aria-label={t.fitRoute}
            title={t.fitRoute}
            onClick={() => setCamera(null)}
          >
            <Maximize />
          </IconButton>
        </Flex>
      </Card>
      <BasemapControls
        lang={lang}
        preferences={basemap}
        failure={basemap.enabled ? (missingBaseKey ? 'key' : baseFailure) : null}
        storageFailed={props.storageFailed}
        onOpenSettings={props.onOpenSettings}
        onRetry={retryBase}
      />
      <div className="rv-scale">
        <span style={{ width: scaleMetres / metresPerPixel }} />
        {scaleMetres >= 1000 ? scaleMetres / 1000 + ' km' : scaleMetres + ' m'}
      </div>
      <div className="rv-coords">
        {displayPos.lat.toFixed(5)}° &nbsp; {displayPos.lon.toFixed(5)}°
      </div>
    </div>
  );
}
