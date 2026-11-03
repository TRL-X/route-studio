import { useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRow = useRef<HTMLButtonElement>(null);
  const ordered = useMemo(() => orderedStations(doc, axis), [axis, doc.vertices, doc.stations]);
  const query = filter.toLowerCase();
  const stationList = ordered.filter(({ station }) => station.name.toLowerCase().includes(query));
  useLayoutEffect(() => {
    const list = listRef.current;
    const row = selectedRow.current;
    if (!list || !row) return;
    const reveal = () => {
      const viewport = list.getBoundingClientRect();
      if (!viewport.height) return;
      const bounds = row.getBoundingClientRect();
      if (bounds.top < viewport.top) list.scrollTop += bounds.top - viewport.top;
      else if (bounds.bottom > viewport.bottom) list.scrollTop += bounds.bottom - viewport.bottom;
    };
    reveal();
    // Also reveal the selection when the narrow-window outline drawer opens.
    const observer = new ResizeObserver(reveal);
    observer.observe(list);
    return () => observer.disconnect();
  }, [selected, ordered, filter]);
  return (
    <aside className="sidebar">
      <div className="panel-heading">
        <Layers size={14} />
        {t.outline}
      </div>
      <button
        className="route-item"
        aria-pressed={selected.type === 'route'}
        onClick={() => onSelect({ type: 'route' })}
      >
        <Route size={16} />
        <span>
          <strong>{example ? t.exampleTag : t.details}</strong>
          <small>
            {doc.vertices.length} {t.vertices}
          </small>
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
      <div className="station-list" ref={listRef}>
        {stationList.map(({ station, meters }) => (
          <button
            key={station.id}
            ref={selected.type === 'station' && selected.id === station.id ? selectedRow : undefined}
            className="station-row"
            aria-pressed={selected.type === 'station' && selected.id === station.id}
            onClick={() => onSelect({ type: 'station', id: station.id })}
          >
            <span className={'station-symbol ' + station.kind} aria-hidden="true" />
            <span>
              <strong title={station.name || t[station.kind]}>{station.name || t[station.kind]}</strong>
              <small>
                <span className="station-kind" title={t[station.kind]}>
                  {t[station.kind]}
                </span>
                <span>{meters === null ? t.noAnchor : (meters / 1000).toFixed(2) + ' km'}</span>
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
