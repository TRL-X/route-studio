import { useId, useMemo, useState } from 'react';
import { Check, MapPin } from 'lucide-react';
import {
  anchorAtDistance,
  anchorPoint,
  distances,
  type Anchor,
  type RouteDocument,
  type Station,
} from '../domain/model';
import { orderedStations, stationPassages } from '../domain/projection';
import type { Copy } from './strings';

interface Props {
  doc: RouteDocument;
  station: Station;
  t: Copy;
  onMove: (anchor: Anchor) => void;
  onPick: () => void;
}

export function StationPosition({ doc, station, t, onMove, onPick }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const helpId = useId();
  const axis = useMemo(() => distances(doc.vertices), [doc.vertices]);
  const positions = useMemo(() => orderedStations(doc, axis), [doc.stations, doc.vertices, axis]);
  const fixed = station.kind === 'start' || station.kind === 'finish';
  const candidates = useMemo(() => {
    if (fixed || !doc.vertices.length) return [];
    const point = station.location ?? (station.anchor && anchorPoint(doc, station.anchor));
    return point ? stationPassages(doc, point, axis) : [];
  }, [doc.vertices, axis, fixed, station.location, station.anchor]);
  const meters = positions.find((row) => row.station.id === station.id)?.meters;
  const value = meters == null ? '' : (meters / 1000).toFixed(4);
  const totalKm = (axis.at(-1) ?? 0) / 1000;
  // Display a bound that can be typed back into the field without exceeding the route.
  const maximum = Math.floor(totalKm * 1e6) / 1e6;
  const editable = !fixed && doc.vertices.length >= 2;
  function move(anchor: Anchor) {
    setDraft(null);
    setInvalid(false);
    if (station.anchor?.vertexId !== anchor.vertexId || station.anchor.fraction !== anchor.fraction)
      onMove(anchor);
  }
  function submit(input: HTMLInputElement) {
    if (draft === null || input.value === value) {
      setDraft(null);
      setInvalid(false);
      return;
    }
    const km = input.valueAsNumber;
    if (!Number.isFinite(km) || km < 0 || km > totalKm) {
      setInvalid(true);
      return;
    }
    move(anchorAtDistance(doc, km * 1000, axis));
  }
  const otherStations = positions.filter((row) => row.station.id !== station.id && row.meters !== null);
  function neighbors(distance: number) {
    const next = otherStations.findIndex((row) => row.meters! > distance);
    const before = otherStations[(next < 0 ? otherStations.length : next) - 1]?.station;
    const after = otherStations[next]?.station;
    return [before, after].flatMap((s) => (s ? [s.name || t[s.kind]] : [])).join(' → ');
  }
  return (
    <>
      <h3>{t.anchor}</h3>
      {editable ? (
        <>
          <label className="field">
            <span>{t.routeDistanceKm}</span>
            <input
              type="number"
              step="any"
              min={0}
              max={totalKm}
              placeholder={t.noAnchor}
              value={draft ?? value}
              aria-invalid={invalid}
              aria-describedby={helpId}
              onChange={(e) => {
                setDraft(e.target.value);
                setInvalid(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') {
                  e.currentTarget.value = value;
                  e.currentTarget.blur();
                }
              }}
              onBlur={(e) => {
                // Picking a pass or repicking on the map replaces the pending manual input.
                if ((e.relatedTarget as Element | null)?.closest('[data-pick-pass]')) {
                  setDraft(null);
                  setInvalid(false);
                } else submit(e.currentTarget);
              }}
            />
          </label>
          <p
            id={helpId}
            className={invalid ? 'station-invalid' : 'hint'}
            role={invalid ? 'alert' : undefined}
          >
            {invalid ? t.routeDistanceRange.replace('{max}', String(maximum)) : t.routeDistanceHelp}
          </p>
          <button type="button" className="sub-action" data-pick-pass onClick={onPick}>
            <MapPin />
            {t.pickRoutePosition}
          </button>
          {(candidates.length > 1 || (!station.anchor && candidates.length > 0)) && (
            <div className="station-passes" role="group" aria-label={t.nearbyPasses}>
              <strong>{t.nearbyPasses}</strong>
              <span className="hint">{t.nearbyPassHelp}</span>
              {candidates.map((candidate) => {
                const active = meters != null && Math.abs(meters - candidate.distance) < 0.05;
                const context = neighbors(candidate.distance);
                return (
                  <button
                    key={candidate.distance}
                    type="button"
                    className="station-pass"
                    data-pick-pass
                    aria-pressed={active}
                    onClick={() => move(candidate.anchor)}
                  >
                    <b>{(candidate.distance / 1000).toFixed(3)} km</b>
                    {active && <Check size={13} />}
                    {context && <small>{context}</small>}
                  </button>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <div className="coordinate-line">{value ? value + ' km' : t.noAnchor}</div>
      )}
    </>
  );
}
