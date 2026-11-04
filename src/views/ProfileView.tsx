import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { distances } from '../domain/model';
import type { Anchor, RouteDocument } from '../domain/model';
import { strings, type Lang } from '../app/strings';
import './views.css';

interface ProfileViewProps {
  doc: RouteDocument;
  lang: Lang;
  selectedSampleIndex: number | null;
  hoveredSampleIndex: number | null;
  mapProbeDistance: number | null;
  focusAnchor?: Anchor | null;
  onSelectSample: (index: number) => void;
  onHoverSample: (index: number | null) => void;
}

const margin = { left: 48, right: 25, top: 18, bottom: 25 };

export function ProfileView({
  doc,
  lang,
  selectedSampleIndex,
  hoveredSampleIndex,
  mapProbeDistance,
  focusAnchor,
  onSelectSample,
  onHoverSample,
}: ProfileViewProps) {
  const t = strings[lang];
  const fillId = useId();
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 150 });
  useLayoutEffect(() => {
    if (!host.current) return;
    const element = host.current;
    const measure = () => {
      if (element.clientWidth > 0 && element.clientHeight > 0)
        setSize({ width: element.clientWidth, height: element.clientHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const route = useMemo(() => {
    const axis = distances(doc.vertices);
    const index = new Map(doc.vertices.map((vertex, i) => [vertex.id, i]));
    const at = (anchor: Anchor) => {
      const i = index.get(anchor.vertexId);
      if (i === undefined) return 0;
      return axis[i] + ((axis[i + 1] ?? axis[i]) - axis[i]) * anchor.fraction;
    };
    return { total: axis.at(-1) ?? 0, at };
  }, [doc.vertices]);
  const { samples, min, max, known } = useMemo(() => {
    let min = Infinity,
      max = -Infinity,
      known = 0;
    const samples = doc.elevation
      .map((sample, i) => {
        if (sample.height !== null) {
          known++;
          min = Math.min(sample.height, min);
          max = Math.max(sample.height, max);
        }
        return { id: i, distance: route.at(sample.anchor), height: sample.height };
      })
      .sort((a, b) => a.distance - b.distance);
    return { samples, min, max, known };
  }, [doc.elevation, route]);
  const w = Math.max(10, size.width - margin.left - margin.right);
  const h = Math.max(10, size.height - margin.top - margin.bottom);
  const bottom = margin.top + h;
  const yPad = Math.max(1, (max - min) * 0.08);
  const low = known ? Math.floor(min - yPad) : 0;
  const high = known ? Math.ceil(max + yPad) : 100;
  const x = (d: number) => margin.left + w * (route.total > 0 ? d / route.total : 0);
  const y = (height: number) => bottom - h * ((height - low) / (high - low));
  const trace = useMemo(() => {
    const chunks: string[] = [],
      areas: string[] = [];
    const dots: { x: number; y: number }[] = [];
    let line = '',
      start = 0,
      end = 0,
      singleY = 0,
      count = 0;
    const close = () => {
      if (line) {
        chunks.push(line);
        areas.push(line + 'L' + end + ' ' + bottom + 'L' + start + ' ' + bottom + 'Z');
        if (count === 1) dots.push({ x: start, y: singleY });
      }
      line = '';
      count = 0;
    };
    for (const s of samples) {
      if (s.height === null) {
        close();
        continue;
      }
      end = margin.left + w * (route.total > 0 ? s.distance / route.total : 0);
      singleY = bottom - (h * (s.height - low)) / (high - low);
      if (!line) start = end;
      line += (line ? 'L' : 'M') + end.toFixed(2) + ' ' + singleY.toFixed(2);
      count++;
    }
    close();
    return { line: chunks.join(''), area: areas.join(''), dots };
  }, [samples, route.total, bottom, w, h, low, high]);

  function nearestSample(d: number) {
    if (!samples.length) return null;
    let lo = 0,
      hi = samples.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (samples[mid].distance < d) lo = mid + 1;
      else hi = mid;
    }
    return lo && Math.abs(samples[lo - 1].distance - d) < Math.abs(samples[lo].distance - d) ? lo - 1 : lo;
  }
  function pointerSample(event: React.PointerEvent<SVGSVGElement> | React.MouseEvent<SVGSVGElement>) {
    const px = event.clientX - event.currentTarget.getBoundingClientRect().left - margin.left;
    return nearestSample((px / w) * route.total);
  }
  function readingAt(distance: number) {
    const i = nearestSample(distance);
    const sample = i === null ? undefined : samples[i];
    // Show a measured height only at a matching sample; other positions have a distance readout.
    return {
      distance,
      height: sample && Math.abs(sample.distance - distance) <= 0.05 ? sample.height : undefined,
    };
  }

  const selected =
    selectedSampleIndex === null ? undefined : samples.find((s) => s.id === selectedSampleIndex);
  const hovered = hoveredSampleIndex === null ? undefined : samples.find((s) => s.id === hoveredSampleIndex);
  const locked = selected ?? (focusAnchor && readingAt(route.at(focusAnchor)));
  const probe = hovered ?? (mapProbeDistance === null ? null : readingAt(mapProbeDistance));
  const readout = probe ?? locked;
  const formatDistance = (d: number) =>
    route.total < 1000 ? Math.round(d) + ' m' : Number((d / 1000).toFixed(2)) + ' km';
  const xTicks = Math.max(1, Math.min(6, Math.floor(w / 100)));
  return (
    <div ref={host} className="rv-profile">
      <svg
        viewBox={'0 0 ' + size.width + ' ' + size.height}
        role="group"
        aria-label={t.profile}
        tabIndex={0}
        onPointerMove={(ev) => {
          const hit = pointerSample(ev);
          onHoverSample(hit === null ? null : samples[hit].id);
        }}
        onPointerLeave={() => onHoverSample(null)}
        onClick={(ev) => {
          const hit = pointerSample(ev);
          if (hit !== null) onSelectSample(samples[hit].id);
        }}
        onKeyDown={(ev) => {
          if (!samples.length || (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft')) return;
          const i = samples.findIndex((s) => s.id === selectedSampleIndex);
          const next = Math.max(0, Math.min(samples.length - 1, i + (ev.key === 'ArrowRight' ? 1 : -1)));
          onHoverSample(null);
          onSelectSample(samples[next].id);
          ev.preventDefault();
          ev.stopPropagation();
        }}
      >
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
            <stop offset="0" stopColor="var(--route)" stopOpacity=".21" />
            <stop offset="1" stopColor="var(--route)" stopOpacity=".06" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((t) => (
          <g className="rv-profile-grid" key={t}>
            <line x1={margin.left} x2={margin.left + w} y1={bottom - h * t} y2={bottom - h * t} />
            {known > 0 && (
              <text x={margin.left - 8} y={bottom - h * t} dy=".35em" textAnchor="end">
                {Math.round(low + (high - low) * t)} m
              </text>
            )}
          </g>
        ))}
        {route.total > 0 &&
          Array.from({ length: xTicks + 1 }, (_, i) => (
            <g className="rv-profile-grid" key={i}>
              <line
                x1={x((route.total * i) / xTicks)}
                x2={x((route.total * i) / xTicks)}
                y1={margin.top}
                y2={bottom}
              />
              <text
                textAnchor={i === xTicks ? 'end' : i === 0 ? 'start' : 'middle'}
                x={x((route.total * i) / xTicks)}
                y={bottom + 16}
              >
                {formatDistance((route.total * i) / xTicks)}
              </text>
            </g>
          ))}
        <path d={trace.area} fill={'url(#' + fillId + ')'} />
        <path d={trace.line} className="rv-profile-line" />
        {trace.dots.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="2.5" fill="var(--route)" />
        ))}
        {doc.stations
          .filter((s) => s.anchor && s.boundary)
          .map((station) => {
            const px = x(route.at(station.anchor!));
            return (
              <path key={station.id} className="rv-stage-tick" d={'M' + px + ' ' + bottom + 'v-7'}>
                <title>{station.name}</title>
              </path>
            );
          })}
        {locked && (
          <g className="rv-profile-cursor">
            <line x1={x(locked.distance)} x2={x(locked.distance)} y1={margin.top} y2={bottom} />
            {locked.height != null && <circle cx={x(locked.distance)} cy={y(locked.height)} r={4} />}
          </g>
        )}
        {probe && probe.distance !== locked?.distance && (
          <g className="rv-profile-probe">
            <line x1={x(probe.distance)} x2={x(probe.distance)} y1={margin.top} y2={bottom} />
            {probe.height != null && <circle cx={x(probe.distance)} cy={y(probe.height)} r={3.5} />}
          </g>
        )}
      </svg>
      {readout && (
        <span className="rv-readout">
          {formatDistance(readout.distance)}
          {readout.height !== undefined &&
            ' · ' + (readout.height === null ? t.missingHeight : readout.height.toFixed(1) + ' m')}
        </span>
      )}
      {!known && <div className="rv-no-profile">{t.noElevationData}</div>}
    </div>
  );
}
