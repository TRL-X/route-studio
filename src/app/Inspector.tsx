import { useState } from 'react';
import { Check, ChevronLeft, ChevronRight, MapPin, Trash2 } from 'lucide-react';
import { anchorDistance, type Point, type RouteDocument, type Sample, type Station } from '../domain/model';
import { deleteVertex, moveVertex, updateStation } from '../domain/edit';
import type { Copy } from './strings';
import { StationPosition } from './StationPosition';

export type Selection =
  { type: 'route' } | { type: 'vertex' | 'station'; id: string } | { type: 'sample'; index: number };
export type Tool = 'select' | 'append' | 'insert' | 'stationAnchor' | 'stationLocation';
interface Props {
  doc: RouteDocument;
  t: Copy;
  selected: Selection;
  choose: (s: Selection) => void;
  change: (doc: RouteDocument) => void;
  setTool: (tool: Tool) => void;
  status: (text: string) => void;
}
function Field({
  label,
  value,
  save,
  number,
  min,
  max,
  optional = false,
  onInvalid,
}: {
  label: string;
  value: string | number | null;
  save: (value: string) => void;
  number?: boolean;
  min?: number;
  max?: number;
  optional?: boolean;
  onInvalid?: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type={number ? 'number' : 'text'}
        step={number ? 'any' : undefined}
        min={min}
        max={max}
        value={draft ?? value ?? ''}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setDraft(null);
            e.currentTarget.value = String(value ?? '');
            e.currentTarget.blur();
          }
        }}
        onBlur={(e) => {
          const raw = e.target.value;
          if (!e.currentTarget.validity.valid || (number && !optional && raw === '')) {
            onInvalid?.();
          } else if (raw !== String(value ?? '')) {
            save(raw);
          }
          setDraft(null);
        }}
      />
    </label>
  );
}
function Stepper({
  label,
  count,
  index,
  select,
}: {
  label: string;
  count: number;
  index: number;
  select: (i: number) => void;
}) {
  return (
    <div className="index-stepper">
      <button aria-label={label + ' −1'} disabled={!index} onClick={() => select(index - 1)}>
        <ChevronLeft size={14} />
      </button>
      <label>
        <span>{label}</span>
        <input
          type="number"
          min={1}
          max={count}
          key={index}
          defaultValue={index + 1}
          onBlur={(e) => {
            const i = e.target.valueAsNumber - 1;
            if (Number.isInteger(i) && i >= 0 && i < count) select(i);
            else e.target.value = String(index + 1);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
      </label>
      <button aria-label={label + ' +1'} disabled={index === count - 1} onClick={() => select(index + 1)}>
        <ChevronRight size={14} />
      </button>
    </div>
  );
}
export function Inspector({ doc, t, selected, choose, change, setTool, status }: Props) {
  const v = selected.type === 'vertex' ? doc.vertices.find((v) => v.id === selected.id) : undefined;
  const station = selected.type === 'station' ? doc.stations.find((s) => s.id === selected.id) : undefined;
  const sample = selected.type === 'sample' ? doc.elevation[selected.index] : undefined;
  const patchStation = (patch: Partial<Station>) => station && change(updateStation(doc, station.id, patch));
  const toSample = (index: number) => choose({ type: 'sample', index });
  function addSample() {
    if (!v) return;
    const existing = doc.elevation.findIndex((s) => s.anchor.vertexId === v.id && !s.anchor.fraction);
    if (existing >= 0) {
      toSample(existing);
      return;
    }
    const added: Sample = { anchor: { vertexId: v.id, fraction: 0 }, height: null };
    const order = new Map(doc.vertices.map((p, i) => [p.id, i]));
    const elevation = [...doc.elevation, added].sort(
      (a, b) =>
        order.get(a.anchor.vertexId)! +
        a.anchor.fraction -
        (order.get(b.anchor.vertexId)! + b.anchor.fraction),
    );
    change({ ...doc, elevation });
    toSample(elevation.indexOf(added));
  }
  function missing() {
    const from = selected.type === 'sample' ? selected.index : -1;
    let index = doc.elevation.findIndex((s, i) => i > from && s.height === null);
    if (index < 0) index = doc.elevation.findIndex((s) => s.height === null);
    if (index >= 0) toSample(index);
    else status(t.noMoreMissing);
  }
  function coords(point: Point, save: (pt: Point) => void) {
    return (
      <div className="coordinate-fields">
        {(['lat', 'lon'] as const).map((key) => (
          <Field
            key={key}
            label={t[key]}
            number
            onInvalid={() => status(t.invalidNumber)}
            min={key === 'lat' ? -90 : -180}
            max={key === 'lat' ? 90 : 180}
            value={point[key]}
            save={(raw) => save({ ...point, [key]: Number(raw) })}
          />
        ))}
      </div>
    );
  }
  const title = v ? t.vertex : station ? t.station : sample ? t.sample : t.details;
  return (
    <aside className="inspector">
      <div className="panel-heading">{t.inspector}</div>
      <div
        className="inspect-content"
        key={selected.type === 'sample' ? selected.index : selected.type === 'route' ? 'route' : selected.id}
      >
        <div className="eyebrow">{t.attributes}</div>
        <h2>{title}</h2>
        {v ? (
          <>
            <Stepper
              label={t.pointList}
              count={doc.vertices.length}
              index={doc.vertices.indexOf(v)}
              select={(i) => choose({ type: 'vertex', id: doc.vertices[i].id })}
            />
            {coords(v, (p) => change(moveVertex(doc, v.id, p)))}
            <button className="sub-action" onClick={addSample}>
              {t.elevation}
            </button>
            <button
              className="danger"
              disabled={doc.vertices.length <= 2}
              onClick={() => {
                change(deleteVertex(doc, v.id));
                choose({ type: 'route' });
              }}
            >
              <Trash2 />
              {t.delete}
            </button>
          </>
        ) : station ? (
          <>
            <Field label={t.name} value={station.name} save={(name) => patchStation({ name })} />
            <Field
              label={t.short}
              value={station.shortLabel ?? ''}
              save={(shortLabel) => patchStation({ shortLabel: shortLabel || undefined })}
            />
            <label className="field">
              <span>{t.type}</span>
              <select
                value={station.kind}
                onChange={(e) => {
                  const kind = e.target.value as Station['kind'];
                  if (kind === 'start' || kind === 'finish') {
                    const v = kind === 'start' ? doc.vertices[0] : doc.vertices.at(-1);
                    patchStation({
                      kind,
                      boundary: true,
                      anchor: v ? { vertexId: v.id, fraction: 0 } : null,
                    });
                  } else patchStation({ kind });
                }}
              >
                {(['start', 'finish', 'cp', 'poi'] as const).map((k) => (
                  <option key={k} value={k}>
                    {t[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                checked={station.boundary}
                disabled={station.kind === 'start' || station.kind === 'finish'}
                onChange={(e) => patchStation({ boundary: e.target.checked })}
              />
              {t.boundary}
            </label>
            <StationPosition
              key={station.id + '/' + station.anchor?.vertexId + '/' + station.anchor?.fraction}
              doc={doc}
              station={station}
              t={t}
              onMove={(anchor) => {
                patchStation({ anchor });
                choose({ type: 'station', id: station.id });
              }}
              onPick={() => setTool('stationAnchor')}
            />
            <h3>{t.location}</h3>
            {station.location ? (
              coords(station.location, (p) => patchStation({ location: p }))
            ) : (
              <p className="hint">{t.same}</p>
            )}
            <button className="sub-action" onClick={() => setTool('stationLocation')}>
              <MapPin />
              {t.pick}
            </button>
            {station.location && (
              <button className="sub-action" onClick={() => patchStation({ location: undefined })}>
                {t.reset}
              </button>
            )}
            {station.kind !== 'start' && station.kind !== 'finish' && (
              <button
                className="danger"
                onClick={() => {
                  change({ ...doc, stations: doc.stations.filter((s) => s.id !== station.id) });
                  choose({ type: 'route' });
                }}
              >
                <Trash2 />
                {t.delete}
              </button>
            )}
          </>
        ) : sample && selected.type === 'sample' ? (
          <>
            <Stepper
              label={t.sampleList}
              count={doc.elevation.length}
              index={selected.index}
              select={toSample}
            />
            <p className="metric-line">
              {t.distance} <strong>{(anchorDistance(doc, sample.anchor) / 1000).toFixed(3)} km</strong>
            </p>
            <Field
              label={t.height}
              value={sample.height}
              number
              optional
              onInvalid={() => status(t.invalidNumber)}
              save={(raw) =>
                change({
                  ...doc,
                  elevation: doc.elevation.map((s, i) =>
                    i === selected.index ? { ...s, height: raw === '' ? null : Number(raw) } : s,
                  ),
                })
              }
            />
            <button className="sub-action" onClick={missing}>
              {t.nextMissing}
            </button>
            <button
              className="danger"
              onClick={() => {
                change({ ...doc, elevation: doc.elevation.filter((_, i) => i !== selected.index) });
                choose({ type: 'route' });
              }}
            >
              <Trash2 />
              {t.delete}
            </button>
          </>
        ) : (
          <>
            <Field label={t.name} value={doc.name} save={(name) => change({ ...doc, name })} />
            <label className="field">
              <span>{t.reference}</span>
              <select
                value={doc.elevationReference}
                onChange={(e) => change({ ...doc, elevationReference: Number(e.target.value) as 0 | 1 | 2 })}
              >
                <option value={0}>{t.unknown}</option>
                <option value={1}>{t.msl}</option>
                <option value={2}>{t.wgs}</option>
              </select>
            </label>
            <h3>{t.geometry}</h3>
            <p className="metric-line">
              {t.geometry}
              <strong>{doc.vertices.length}</strong>
            </p>
            {doc.vertices.length > 0 && (
              <button
                className="sub-action"
                onClick={() => choose({ type: 'vertex', id: doc.vertices[0].id })}
              >
                {t.first}
              </button>
            )}
            <h3>{t.elevation}</h3>
            <p className="metric-line">
              {t.missingCount}
              <strong>{doc.elevation.filter((s) => s.height === null).length}</strong>
            </p>
            {doc.elevation.some((s) => s.height === null) && (
              <button className="sub-action" onClick={missing}>
                {t.nextMissing}
              </button>
            )}
            <p className="hint">{t.sampleHelp}</p>
          </>
        )}
      </div>
      <div className="inspector-foot">
        <Check size={13} />
        {t.routeUnits}
      </div>
    </aside>
  );
}
