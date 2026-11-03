import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Map as LibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { anchorPoint, lonDelta, nearestAnchor } from '../domain/model';
import type { Anchor, RouteDocument } from '../domain/model';
import { strings, type Lang } from '../app/strings';
import './views.css';

type Point = { lat: number; lon: number };
type XY = { x: number; y: number };
type Camera = XY & { zoom: number };
type Tool = 'select' | 'add' | 'anchor' | 'location';
interface MapViewProps {
  doc: RouteDocument;
  lang: Lang;
  tool: Tool;
  selectedVertexId: string | null;
  selectedStationId: string | null;
  focusAnchor?: Anchor | null;
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

const styleURL = import.meta.env.VITE_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty';

// The editor owns its 2D camera. A basemap is an optional underlay using the same
// Mercator camera, so edits and hit testing also work without a network or GPU.
function Basemap({ camera, onFailure }: { camera: Camera; onFailure: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<LibreMap | null>(null);
  const latestCamera = useRef(camera);
  const failure = useRef(onFailure);
  latestCamera.current = camera;
  failure.current = onFailure;
  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | undefined;
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
        style: styleURL,
        interactive: false,
        center: [first.x * 360 - 180, unproject(first).lat],
        zoom: first.zoom,
        canvasContextAttributes: { antialias: false },
        attributionControl: { compact: true },
      });
      instance.current = map;
      map.on('error', () => {
        if (!cancelled && !map.isStyleLoaded()) failure.current();
      });
      map.on('webglcontextlost', () => {
        if (!cancelled) failure.current();
      });
      observer = new ResizeObserver(() => map.resize());
      observer.observe(host.current);
    })().catch(() => {
      if (!cancelled) failure.current();
    });
    return () => {
      cancelled = true;
      observer?.disconnect();
      instance.current?.remove();
      instance.current = null;
    };
  }, []);
  useEffect(() => {
    instance.current?.jumpTo({ center: [camera.x * 360 - 180, unproject(camera).lat], zoom: camera.zoom });
  }, [camera]);
  return <div className="rv-base" ref={host} />;
}

export function MapView(props: MapViewProps) {
  const { doc, lang, tool, selectedVertexId, selectedStationId } = props;
  const t = strings[lang];
  const container = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 800, height: 450 });
  const [manualCamera, setCamera] = useState<Camera | null>(null);
  const [showBase, setShowBase] = useState(false);
  const [baseFailed, setBaseFailed] = useState(false);
  const [hover, setHover] = useState<Point | null>(null);
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
  const activeVertex = screen.find((p) => p.id === selectedVertexId);
  const focusPoint = props.focusAnchor
    ? screenPoint(anchorPoint(doc, props.focusAnchor, vertexIndices))
    : null;
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
    setHover(unproject(toWorld(p)));
    const d = drag.current;
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
    const point = unproject(toWorld(here(ev)));
    if (d.moved) {
      if (d.vertex) {
        setCamera(d.camera);
        props.onSelectVertex(d.vertex);
        props.onMoveVertex(d.vertex, point);
      }
      return;
    }
    if (tool === 'add') {
      setCamera(camera);
      props.onAddVertex(point);
    } else if (tool === 'location') props.onPickLocation(point);
    else if (tool === 'anchor' && doc.vertices.length) props.onPickAnchor(nearestAnchor(doc, point));
    else if (d.station) props.onSelectStation(d.station);
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
  for (
    let lon = Math.ceil(lon0 / stepX) * stepX;
    lon <= lon0 + (size.width * 360) / scale + 1e-10;
    lon += stepX
  ) {
    const x = toScreen({ x: (lon + 180) / 360, y: 0 }).x;
    grid.push(
      <g key={'x' + lon}>
        <path d={'M' + x + ' 0v' + size.height} />
        <text x={x + 5} y="14">
          {format(wrap(lon), stepX)}°
        </text>
      </g>,
    );
  }
  for (let lat = Math.ceil(lat0 / stepY) * stepY; lat <= lat1 + 1e-10; lat += stepY) {
    const y = toScreen(project({ lat, lon: 0 })).y;
    grid.push(
      <g key={'y' + lat}>
        <path d={'M0 ' + y + 'h' + size.width} />
        <text x="7" y={y - 4}>
          {format(lat, stepY)}°
        </text>
      </g>,
    );
  }

  const metresPerPixel = (40075016.69 * Math.cos(center.lat * radians)) / scale;
  const scaleMetres = niceStep(40 * metresPerPixel);
  const displayPos = hover ?? center;
  return (
    <div className={'rv-map' + (showBase ? ' rv-has-base' : '')} ref={container}>
      {showBase && (
        <Basemap
          camera={camera}
          onFailure={() => {
            setBaseFailed(true);
            setShowBase(false);
          }}
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
        onPointerLeave={() => setHover(null)}
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
        {handles.map((p) => (
          <circle className="rv-vertex" key={p.id} cx={p.x} cy={p.y} r={2.4} />
        ))}
        {doc.stations.map((station, i) => {
          const anchor = station.anchor ? screenPoint(anchorPoint(doc, station.anchor, vertexIndices)) : null;
          const location = station.location ? screenPoint(station.location) : null;
          const marker = anchor ?? location;
          if (!marker) return null;
          const chosen = station.id === selectedStationId;
          const label = station.shortLabel || station.name || String(i + 1);
          return (
            <g
              key={station.id}
              data-station={station.id}
              className={'rv-station' + (chosen ? ' rv-station-active' : '')}
            >
              <title>{station.name || label}</title>
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
              <rect
                className="rv-station-pin"
                x={marker.x - 4.5}
                y={marker.y - 4.5}
                width={9}
                height={9}
                rx={1.8}
                transform={'rotate(45 ' + marker.x + ' ' + marker.y + ')'}
              />
              <text x={marker.x + 9} y={marker.y - 7}>
                {label}
              </text>
            </g>
          );
        })}
        {activeVertex && (
          <circle className="rv-active-vertex" cx={activeVertex.x} cy={activeVertex.y} r={5} />
        )}
        {focusPoint && <circle className="rv-anchor-focus" cx={focusPoint.x} cy={focusPoint.y} r={7} />}
      </svg>
      <div className="rv-zoom" aria-label={t.mapView}>
        <button type="button" aria-label={t.zoomIn} title={t.zoomIn} onClick={() => zoomBy(1)}>
          +
        </button>
        <button type="button" aria-label={t.zoomOut} title={t.zoomOut} onClick={() => zoomBy(-1)}>
          −
        </button>
        <button type="button" aria-label={t.fitRoute} title={t.fitRoute} onClick={() => setCamera(null)}>
          <svg viewBox="0 0 18 18" aria-hidden="true">
            <path d="M2 7V2h5m4 0h5v5m0 4v5h-5m-4 0H2v-5" />
          </svg>
        </button>
      </div>
      <div className="rv-basemap-tools">
        {baseFailed && <span role="status">{t.basemapUnavailable}</span>}
        <button
          type="button"
          aria-pressed={showBase}
          onClick={() => {
            setBaseFailed(false);
            setShowBase(!showBase);
          }}
        >
          <svg viewBox="0 0 18 18" aria-hidden="true">
            <path d="m2 6 7-4 7 4-7 4zm0 4 7 4 7-4" />
          </svg>
          {t.basemap}
        </button>
      </div>
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
