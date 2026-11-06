import { Button } from '@radix-ui/themes';
import { Check } from 'lucide-react';
import type { Anchor, Station } from '../../domain/model';
import type { StationPassage } from '../../domain/projection';
import type { Copy } from '../../i18n/index';

interface Props {
  candidates: StationPassage[];
  positions: { station: Station; meters: number | null }[];
  stationId?: string;
  meters?: number | null;
  title: string;
  t: Copy;
  onPick: (anchor: Anchor) => void;
}

export function StationPassOptions({ candidates, positions, stationId, meters, title, t, onPick }: Props) {
  const others = positions.filter((row) => row.station.id !== stationId && row.meters !== null);
  return (
    <div className="station-passes" role="group" aria-label={title}>
      <strong>{title}</strong>
      <span className="hint">{t.nearbyPassHelp}</span>
      {candidates.map((candidate) => {
        const active = meters != null && Math.abs(meters - candidate.distance) < 0.05;
        const next = others.findIndex((row) => row.meters! > candidate.distance);
        const before = others[(next < 0 ? others.length : next) - 1]?.station;
        const after = others[next]?.station;
        const context = [before, after].flatMap((s) => (s ? [s.name || t[s.kind]] : [])).join(' → ');
        return (
          <Button
            variant={active ? 'soft' : 'surface'}
            color={active ? 'blue' : 'gray'}
            key={candidate.distance}
            type="button"
            className="station-pass"
            data-pick-pass
            aria-pressed={meters == null ? undefined : active}
            onClick={() => onPick(candidate.anchor)}
          >
            <b>{(candidate.distance / 1000).toFixed(3)} km</b>
            {active && <Check size={13} />}
            {context && <small>{context}</small>}
          </Button>
        );
      })}
    </div>
  );
}
