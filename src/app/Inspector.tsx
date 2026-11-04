import { Choice } from './Choice';
import { TextField, Checkbox, Button, IconButton } from '@radix-ui/themes';
import { useId } from 'react';
import { Check, ChevronLeft, ChevronRight, MapPin, Trash2 } from 'lucide-react';
import { anchorDistance, type Point, type RouteDocument, type Sample, type Station } from '../domain/model';
import { moveVertex, updateStation } from '../domain/edit';
import type { Copy, Lang } from './strings';
import { DeclinationFields } from './DeclinationFields';
import type { LookupState } from './useDeclinationLookup';
import { Field } from './Field';
import { StationPosition } from './StationPosition';
import { PropertyGroup } from './PropertyGroup';

export type Selection =
  { type: 'route' } | { type: 'vertex' | 'station'; id: string } | { type: 'sample'; index: number };
export type Tool = 'select' | 'append' | 'insert' | 'newStation' | 'stationAnchor' | 'stationLocation';
interface Props {
  issue?: string;
  lang: Lang;
  lookup: LookupState;
  magneticExpanded: boolean;
  onMagneticExpanded: (expanded: boolean) => void;
  onDelete: () => void;
  canDelete: boolean;
  doc: RouteDocument;
  t: Copy;
  selected: Selection;
  choose: (s: Selection) => void;
  change: (doc: RouteDocument) => void;
  setTool: (tool: Tool) => void;
  status: (text: string) => void;
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
  const inputId = useId();
  return (
    <div className="index-stepper">
      <label htmlFor={inputId}>{label}</label>
      <IconButton
        variant="surface"
        color="gray"
        aria-label={label + ' −1'}
        disabled={!index}
        onClick={() => select(index - 1)}
      >
        <ChevronLeft size={14} />
      </IconButton>
      <TextField.Root
        id={inputId}
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
      <IconButton
        variant="surface"
        color="gray"
        aria-label={label + ' +1'}
        disabled={index === count - 1}
        onClick={() => select(index + 1)}
      >
        <ChevronRight size={14} />
      </IconButton>
    </div>
  );
}
export function Inspector({
  doc,
  t,
  selected,
  choose,
  change,
  setTool,
  status,
  issue,
  lang,
  lookup,
  magneticExpanded,
  onMagneticExpanded,
  onDelete,
  canDelete,
}: Props) {
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
            increment={0.00001}
            unit="°"
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
  const diagnostic = issue && (
    <div className="field-issue" id="inspector-diagnostic" role="note">
      <strong>{t.validation}</strong>
      <p>{issue}</p>
    </div>
  );
  return (
    <aside className="inspector">
      <div className="panel-heading">{t.inspector}</div>
      <div
        className="inspect-content"
        key={selected.type === 'sample' ? selected.index : selected.type === 'route' ? 'route' : selected.id}
      >
        <h2>{title}</h2>
        {!sample && diagnostic}
        {v ? (
          <>
            <Stepper
              label={t.pointList}
              count={doc.vertices.length}
              index={doc.vertices.indexOf(v)}
              select={(i) => choose({ type: 'vertex', id: doc.vertices[i].id })}
            />
            <PropertyGroup title={t.geometry}>
              {coords(v, (p) => change(moveVertex(doc, v.id, p)))}
            </PropertyGroup>
            <div className="inspector-actions">
              <Button variant="surface" color="gray" onClick={addSample}>
                {t.elevation}
              </Button>
              <Button
                variant="soft"
                color="red"

                disabled={!canDelete}
                onClick={onDelete}
              >
                <Trash2 />
                {t.delete}
              </Button>
            </div>
          </>
        ) : station ? (
          <>
            <PropertyGroup title={t.attributes}>
              <Field label={t.name} value={station.name} save={(name) => patchStation({ name })} />
              <Field
                label={t.short}
                value={station.shortLabel ?? ''}
                save={(shortLabel) => patchStation({ shortLabel: shortLabel || undefined })}
              />
              <label className="field">
                <span>{t.type}</span>
                <Choice
                  value={station.kind}
                  onValueChange={(value) => {
                    const kind = value as Station['kind'];
                    if (kind === 'start' || kind === 'finish') {
                      const v = kind === 'start' ? doc.vertices[0] : doc.vertices.at(-1);
                      patchStation({
                        kind,
                        boundary: true,
                        anchor: v ? { vertexId: v.id, fraction: 0 } : null,
                      });
                    } else patchStation({ kind });
                  }}
                  options={(['start', 'finish', 'cp', 'poi'] as const).map((k) => ({
                    value: k,
                    label: t[k],
                  }))}
                />
              </label>
              <label className="check-field">
                <Checkbox
                  checked={station.boundary}
                  disabled={station.kind === 'start' || station.kind === 'finish'}
                  onCheckedChange={(value) => patchStation({ boundary: value === true })}
                />
                {t.boundary}
              </label>
            </PropertyGroup>
            <StationPosition
              key={station.id}
              doc={doc}
              station={station}
              t={t}
              onMove={(anchor) => {
                patchStation({ anchor });
                choose({ type: 'station', id: station.id });
              }}
              onPick={() => setTool('stationAnchor')}
            />
            <PropertyGroup title={t.location}>
              {station.location ? (
                coords(station.location, (p) => patchStation({ location: p }))
              ) : (
                <p className="hint">{t.same}</p>
              )}
              <div className="inspector-actions">
                <Button
                  variant="surface"
                  color="gray"

                  onClick={() => setTool('stationLocation')}
                >
                  <MapPin />
                  {t.pick}
                </Button>
                {station.location && (
                  <Button
                    variant="surface"
                    color="gray"

                    onClick={() => patchStation({ location: undefined })}
                  >
                    {t.reset}
                  </Button>
                )}
                {station.kind !== 'start' && station.kind !== 'finish' && (
                  <Button
                    variant="soft"
                    color="red"

                    disabled={!canDelete}
                    onClick={onDelete}
                  >
                    <Trash2 />
                    {t.delete}
                  </Button>
                )}
              </div>
            </PropertyGroup>
          </>
        ) : sample && selected.type === 'sample' ? (
          <>
            <Stepper
              label={t.sampleList}
              count={doc.elevation.length}
              index={selected.index}
              select={toSample}
            />
            {diagnostic}
            <PropertyGroup title={t.elevation}>
              <p className="metric-line">
                {t.distance} <strong>{(anchorDistance(doc, sample.anchor) / 1000).toFixed(3)} km</strong>
              </p>
              <Field
                label={t.height}
                displayLabel={t.elevation}
                describedBy={issue ? 'inspector-diagnostic' : undefined}
                value={sample.height}
                number
                unit="m"
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
              <div className="inspector-actions">
                <Button variant="surface" color="gray" onClick={missing}>
                  {t.nextMissing}
                </Button>
                <Button
                  variant="soft"
                  color="red"

                  disabled={!canDelete}
                  onClick={onDelete}
                >
                  <Trash2 />
                  {t.delete}
                </Button>
              </div>
            </PropertyGroup>
          </>
        ) : (
          <>
            <PropertyGroup title={t.attributes}>
              <Field label={t.name} value={doc.name} save={(name) => change({ ...doc, name })} />
              <label className="field">
                <span>{t.reference}</span>
                <Choice
                  value={doc.elevationReference}
                  onValueChange={(value) =>
                    change({ ...doc, elevationReference: Number(value) as 0 | 1 | 2 })
                  }
                  options={[
                    { value: 0, label: t.unknown },
                    { value: 1, label: t.msl },
                    { value: 2, label: t.wgs },
                  ]}
                />
              </label>
            </PropertyGroup>
            <details
              className="property-group magnetic-properties"
              open={magneticExpanded}
              onToggle={(event) => onMagneticExpanded(event.currentTarget.open)}
            >
              <summary>{t.magTitle}</summary>
              {magneticExpanded && (
                <div className="property-body">
                  <DeclinationFields lang={lang} doc={doc} t={t} change={change} lookup={lookup} />
                </div>
              )}
            </details>
            <PropertyGroup title={t.geometry}>
              <p className="metric-line">
                {t.geometry}
                <strong>{doc.vertices.length}</strong>
              </p>
              {doc.vertices.length > 0 && (
                <Button
                  variant="surface"
                  color="gray"

                  onClick={() => choose({ type: 'vertex', id: doc.vertices[0].id })}
                >
                  {t.first}
                </Button>
              )}
            </PropertyGroup>
            <PropertyGroup title={t.elevation}>
              <p className="metric-line">
                {t.missingCount}
                <strong>{doc.elevation.filter((s) => s.height === null).length}</strong>
              </p>
              {doc.elevation.some((s) => s.height === null) && (
                <Button variant="surface" color="gray" onClick={missing}>
                  {t.nextMissing}
                </Button>
              )}
              <p className="hint">{t.sampleHelp}</p>
            </PropertyGroup>
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
