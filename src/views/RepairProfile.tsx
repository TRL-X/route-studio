import { IconButton, Button, Flex } from '@radix-ui/themes';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import type { ProfileReading } from '../domain/terrain-comparison';
import { strings, type Lang } from '../app/strings';
import en from '../i18n/en.repair.json' with { type: 'json' };
import zh from '../i18n/zh-CN.repair.json' with { type: 'json' };
import './repair-profile.css';

interface RepairProfileProps {
  original: readonly ProfileReading[];
  hasOriginal: boolean;
  lang: Lang;
  preview?: readonly ProfileReading[];
  attention?: readonly { startM: number; endM: number }[];
}

interface View {
  left: number;
  span: number;
}

const margin = { left: 62, right: 12, top: 26, bottom: 26 };
const empty: readonly ProfileReading[] = [];
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));

function viewAt(left: number, span: number, total: number): View {
  const length = clamp(span, Math.min(total, 1), total);
  return { left: clamp(left, 0, total - length), span: length };
}

function formatDistance(meters: number, kilometers: boolean, interval: number) {
  if (!kilometers) return Number(meters.toFixed(interval < 1 ? 1 : 0)) + ' m';
  const precision = interval >= 10_000 ? 1 : interval >= 1_000 ? 2 : 3;
  return Number((meters / 1000).toFixed(precision)) + ' km';
}

function lowerBound(readings: readonly ProfileReading[], distance: number, afterEquals = false) {
  let low = 0,
    high = readings.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (readings[mid].distance < distance || (afterEquals && readings[mid].distance === distance))
      low = mid + 1;
    else high = mid;
  }
  return low;
}

// Preserve peaks at chart resolution. A pixel containing a break cannot connect its two neighbors.
function trace(
  readings: readonly ProfileReading[],
  view: View,
  width: number,
  x: (meters: number) => number,
  y: (meters: number) => number,
) {
  const start = Math.max(0, lowerBound(readings, view.left) - 1);
  const end = Math.min(readings.length, lowerBound(readings, view.left + view.span, true) + 1);
  const dense = end - start > width * 4;
  const path: string[] = [];
  let joined = false;
  function emit(i: number) {
    const point = readings[i];
    // A tiny round-capped stroke also shows an isolated measurement.
    path.push((joined ? 'L' : 'M') + x(point.distance).toFixed(2) + ' ' + y(point.height!).toFixed(2));
    if (!joined) path.push('h0.01');
    joined = true;
  }
  for (let i = start; i < end;) {
    let stop = i + 1;
    const column = Math.floor(x(readings[i].distance));
    if (dense) {
      while (stop < end && Math.floor(x(readings[stop].distance)) === column) stop++;
    }
    if (stop === i + 1) {
      if (readings[i].height === null) joined = false;
      else emit(i);
    } else {
      let min = -1,
        max = -1,
        broken = false;
      for (let j = i; j < stop; j++) {
        const h = readings[j].height;
        if (h === null) {
          broken = true;
          continue;
        }
        if (min < 0 || h < readings[min].height!) min = j;
        if (max < 0 || h > readings[max].height!) max = j;
      }
      if (broken) {
        for (const j of [min, max])
          if (j >= 0) {
            joined = false;
            emit(j);
          }
        joined = false;
      } else {
        for (const j of [...new Set([i, min, max, stop - 1])].sort((a, b) => a - b)) emit(j);
      }
    }
    i = stop;
  }
  return path.join('');
}

// Compare both profiles on the same scale even when their height references differ.
export function RepairProfile({
  original: samples,
  hasOriginal,
  lang,
  preview = empty,
  attention = [],
}: RepairProfileProps) {
  const t = strings[lang],
    copy = lang === 'zh' ? zh : en;
  const svg = useRef<SVGSVGElement>(null),
    clip = useId();
  const [size, setSize] = useState({ width: 640, height: 240 });
  useLayoutEffect(() => {
    const node = svg.current!;
    function measure() {
      const { width, height } = node.getBoundingClientRect();
      if (width && height)
        setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const total = samples.at(-1)?.distance ?? 0;
  const [camera, setCamera] = useState<View | null>(null);
  const view = camera ? viewAt(camera.left, camera.span, total) : { left: 0, span: total };
  const width = Math.max(1, size.width - margin.left - margin.right),
    bottom = size.height - margin.bottom;
  const domain = useMemo(() => {
    let lo = Infinity,
      hi = -Infinity;
    for (const series of [samples, preview]) {
      for (const { height } of series) {
        if (height === null) continue;
        lo = Math.min(lo, height);
        hi = Math.max(hi, height);
      }
    }
    if (!Number.isFinite(lo)) return null;
    const pad = Math.max(1, (hi - lo) * 0.08);
    return { lo: Math.floor(lo - pad), hi: Math.ceil(hi + pad) };
  }, [samples, preview]);
  const curves = useMemo(() => {
    if (!domain) return null;
    const x = (m: number) => margin.left + (view.span ? (m - view.left) / view.span : 0) * width;
    const y = (h: number) => bottom - ((h - domain.lo) / (domain.hi - domain.lo)) * (bottom - margin.top);
    return { original: trace(samples, view, width, x, y), preview: trace(preview, view, width, x, y) };
  }, [samples, preview, domain, view.left, view.span, width, bottom]);

  const ranges = useMemo(() => attention.slice().sort((a, b) => a.startM - b.startM), [attention]);
  // Draw all hints as one strip. On a long route, adjacent hints can share a screen pixel.
  const strip = useMemo(() => {
    const segments: string[] = [];
    let start = -1,
      end = -1;
    for (const range of ranges) {
      if (range.endM < view.left) continue;
      if (range.startM > view.left + view.span) break;
      const left = clamp(Math.floor(((range.startM - view.left) / (view.span || 1)) * width), 0, width - 1);
      const right = clamp(Math.ceil(((range.endM - view.left) / (view.span || 1)) * width), left + 1, width);
      if (start >= 0 && left > end + 1) {
        segments.push('M' + (margin.left + start) + ' 14H' + (margin.left + end));
        start = -1;
      }
      if (start < 0) start = left;
      end = Math.max(end, right);
    }
    if (start >= 0) segments.push('M' + (margin.left + start) + ' 14H' + (margin.left + end));
    return segments.join('');
  }, [ranges, view.left, view.span, width]);

  const zoom = useCallback(
    (factor: number, fraction = 0.5) =>
      setCamera((prev) => {
        const v = prev ? viewAt(prev.left, prev.span, total) : { left: 0, span: total };
        const len = clamp(v.span * factor, Math.min(total, 1), total);
        return viewAt(v.left + (v.span - len) * fraction, len, total);
      }),
    [total],
  );
  useEffect(() => {
    const node = svg.current!;
    function wheel(e: WheelEvent) {
      if (!total || !e.deltaY || (view.span >= total && e.deltaY > 0)) return;
      e.preventDefault();
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? size.height : 1);
      const fraction = clamp((e.clientX - node.getBoundingClientRect().left - margin.left) / width, 0, 1);
      zoom(Math.exp(clamp(delta * 0.003, -1, 1)), fraction);
    }
    node.addEventListener('wheel', wheel, { passive: false });
    return () => node.removeEventListener('wheel', wheel);
  }, [total, view.span, zoom, width, size.height]);
  const drag = useRef<{ id: number; x: number; view: View } | null>(null);
  const ticks = total > 0 ? Math.max(1, Math.min(6, Math.floor(width / 104))) : 0;
  return (
    <div className="repair-profile">
      <Flex align="center" justify="between" gap="2" wrap="wrap" py="1">
        <div className="profile-preview-key">
          {hasOriginal && (
            <span>
              <i />
              {copy.currentLine}
            </span>
          )}
          {preview.length > 0 && (
            <span>
              <i className="new" />
              {copy.replacementLine}
            </span>
          )}
          {ranges.length > 0 && (
            <span>
              <i className="attention" />
              {copy.attention}
            </span>
          )}
        </div>
        <Flex align="center" gap="2">
          <IconButton
            variant="ghost"
            color="gray"
            type="button"
            aria-label={t.zoomOut}
            disabled={view.span >= total}
            onClick={() => zoom(1.6)}
          >
            <Minus size={15} />
          </IconButton>
          <IconButton
            variant="ghost"
            color="gray"
            type="button"
            aria-label={t.zoomIn}
            disabled={view.span <= Math.min(1, total)}
            onClick={() => zoom(1 / 1.6)}
          >
            <Plus size={15} />
          </IconButton>
          <Button
            variant="surface"
            color="gray"
            type="button"
            disabled={view.span >= total}
            onClick={() => setCamera(null)}
          >
            {t.fitRoute}
          </Button>
        </Flex>
      </Flex>
      <svg
        ref={svg}
        className="repair-plot"
        data-zoomed={view.span < total}
        role="img"
        aria-label={t.profile}
        tabIndex={0}
        viewBox={'0 0 ' + size.width + ' ' + size.height}
        onPointerDown={(e) => {
          if (e.button !== 0 || !e.isPrimary || view.span >= total) return;
          drag.current = { id: e.pointerId, x: e.clientX, view };
          e.currentTarget.setPointerCapture(e.pointerId);
          e.currentTarget.classList.add('dragging');
        }}
        onPointerMove={(e) => {
          const start = drag.current;
          if (!start || start.id !== e.pointerId) return;
          setCamera(
            viewAt(
              start.view.left - ((e.clientX - start.x) * start.view.span) / width,
              start.view.span,
              total,
            ),
          );
        }}
        onLostPointerCapture={(e) => {
          drag.current = null;
          e.currentTarget.classList.remove('dragging');
        }}
        onKeyDown={(e) => {
          if (e.key === '+' || e.key === '=') zoom(1 / 1.6);
          else if (e.key === '-') zoom(1.6);
          else if (e.key === 'Home') setCamera(null);
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
            setCamera(
              viewAt(view.left + (e.key === 'ArrowRight' ? 1 : -1) * view.span * 0.2, view.span, total),
            );
          else return;
          e.preventDefault();
        }}
      >
        <defs>
          <clipPath id={clip}>
            <rect x={margin.left} y={margin.top - 2} width={width} height={bottom - margin.top + 4} />
          </clipPath>
        </defs>
        {[0, 0.5, 1].map((n) => {
          const py = bottom - n * (bottom - margin.top);
          return (
            <g className="rv-profile-grid" key={n}>
              <line x1={margin.left} x2={margin.left + width} y1={py} y2={py} />
              {domain && (
                <text x={margin.left - 6} y={py} dy=".35em" textAnchor="end">
                  {Math.round(domain.lo + n * (domain.hi - domain.lo))} m
                </text>
              )}
            </g>
          );
        })}
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const fraction = ticks ? i / ticks : 0;
          return (
            <text
              className="repair-distance"
              key={i}
              x={margin.left + width * fraction}
              y={bottom + 17}
              textAnchor={i === 0 ? 'start' : i === ticks ? 'end' : 'middle'}
            >
              {formatDistance(
                view.left + view.span * fraction,
                view.left + view.span >= 1000,
                view.span / (ticks || 1),
              )}
            </text>
          );
        })}
        {strip && (
          <path className="profile-preview-strip" d={strip}>
            <title>{copy.attention}</title>
          </path>
        )}
        {curves ? (
          <g clipPath={'url(#' + clip + ')'} className="profile-preview-lines">
            <path className="proposed" d={curves.preview} />
            <path className="original" d={curves.original} />
          </g>
        ) : (
          <text
            className="repair-empty"
            x={margin.left + width / 2}
            y={(bottom + margin.top) / 2}
            textAnchor="middle"
          >
            {t.noElevationData}
          </text>
        )}
      </svg>
    </div>
  );
}
