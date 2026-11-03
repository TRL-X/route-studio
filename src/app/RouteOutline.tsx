import { useMemo, useState } from 'react';
import { File, Layers, Plus, Route, Search } from 'lucide-react';
import type { RouteDocument } from '../domain/model';
import { orderedStations } from '../domain/projection';
import type { Selection } from './Inspector';
import type { Copy } from './strings';

interface OutlineProps {
  doc: RouteDocument;
  axis: number[];
  selected: Selection;
  example: boolean;
  source: string;
  t: Copy;
  onSelect: (selected: Selection) => void;
  onAddStation: () => void;
}

export function RouteOutline({
  doc,
  axis,
  selected,
  example,
  source,
  t,
  onSelect,
  onAddStation,
}: OutlineProps) {
  const [filter, setFilter] = useState('');
  const ordered = useMemo(() => orderedStations(doc, axis), [axis, doc.vertices, doc.stations]);
  const query = filter.toLowerCase();
  const stationList = ordered.filter(({ station }) => station.name.toLowerCase().includes(query));
  const lengthKm = (axis.at(-1) ?? 0) / 1000;
  return (
    <aside className="sidebar">
      <div className="panel-heading">
        <Layers size={14} />
        {t.workspace}
      </div>
      <button
        className={'route-card' + (selected.type === 'route' ? ' active' : '')}
        onClick={() => onSelect({ type: 'route' })}
      >
        <span className="document-tag">
          <Route size={14} />
          {example ? t.exampleTag : t.project}
        </span>
        <strong>{doc.name || t.untitled}</strong>
        <span>
          {lengthKm.toFixed(2)} km <i>·</i> {doc.vertices.length} {t.vertices}
        </span>
      </button>
      <div className="station-heading">
        <span>{t.stations}</span>
        <b>{doc.stations.length}</b>
        <button
          className="icon"
          aria-label={t.addStation}
          title={t.addStation}
          disabled={doc.vertices.length < 2}
          onClick={onAddStation}
        >
          <Plus />
        </button>
      </div>
      <label className="filter">
        <Search size={14} />
        <input
          aria-label={t.filter}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t.filter}
        />
      </label>
      <div className="station-list">
        {stationList.map(({ station, meters }) => (
          <button
            key={station.id}
            className={
              'station-row' + (selected.type === 'station' && selected.id === station.id ? ' chosen' : '')
            }
            onClick={() => onSelect({ type: 'station', id: station.id })}
          >
            <span className={'station-symbol ' + station.kind} />
            <span>
              <strong>{station.name || t[station.kind]}</strong>
              <small>
                {t[station.kind]} <i>·</i> {meters === null ? t.noAnchor : (meters / 1000).toFixed(2) + ' km'}
              </small>
            </span>
          </button>
        ))}
        {!stationList.length && <p className="hint">{filter ? t.noStations : t.emptyStations}</p>}
      </div>
      <div className="local-source">
        <File size={16} />
        <span>{source || t.local}</span>
      </div>
    </aside>
  );
}
