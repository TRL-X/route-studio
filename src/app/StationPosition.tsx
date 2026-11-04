import { Button } from '@radix-ui/themes';
import { useEffect, useId, useMemo, useState } from 'react';
import { MapPin } from 'lucide-react';
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
import { StationPassOptions } from './StationPassOptions';
import { NumberInput } from './NumberInput';
import { PropertyGroup } from './PropertyGroup';

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
  const inputId = useId();
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
  useEffect(() => {
    setDraft(null);
    setInvalid(false);
  }, [value, station.anchor?.vertexId, station.anchor?.fraction]);
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
  return (
    <PropertyGroup title={t.anchor}>
      {editable ? (
        <>
          <div className="field">
            <label htmlFor={inputId}>{t.distance}</label>
            <NumberInput
              id={inputId}
              aria-label={t.routeDistanceKm}
              label={t.routeDistanceKm}
              unit="km"
              increment={0.01}
              onStep={(km) => move(anchorAtDistance(doc, km * 1000, axis))}
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
          </div>
          <p
            id={helpId}
            className={invalid ? 'station-invalid' : 'hint'}
            role={invalid ? 'alert' : undefined}
          >
            {invalid ? t.routeDistanceRange.replace('{max}', String(maximum)) : t.routeDistanceHelp}
          </p>
          <Button
            variant="surface"
            color="gray"
            type="button"

            data-pick-pass
            onClick={onPick}
          >
            <MapPin />
            {t.pickRoutePosition}
          </Button>
          {(candidates.length > 1 || (!station.anchor && candidates.length > 0)) && (
            <StationPassOptions
              candidates={candidates}
              positions={positions}
              stationId={station.id}
              meters={meters}
              title={t.nearbyPasses}
              t={t}
              onPick={move}
            />
          )}
        </>
      ) : (
        <div className="coordinate-line">{value ? value + ' km' : t.noAnchor}</div>
      )}
    </PropertyGroup>
  );
}
