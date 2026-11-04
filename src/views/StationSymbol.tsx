import type { Station } from '../domain/model';
import './station-symbol.css';

const paths: Record<Station['kind'], string> = {
  start: 'M0-5.75 5.5 4.5-5.5 4.5Z',
  finish: 'M-4.5-4.5h9v9h-9Z',
  cp: 'M0-5.75 5.75 0 0 5.75-5.75 0Z',
  poi: 'M5 0a5 5 0 1 0-10 0 5 5 0 1 0 10 0Z',
};

export function StationSymbol({
  kind,
  boundary,
  x = 0,
  y = 0,
  className = '',
}: Pick<Station, 'kind' | 'boundary'> & { x?: number; y?: number; className?: string }) {
  return (
    <path
      className={'station-glyph ' + className}
      data-boundary={boundary}
      d={paths[kind]}
      transform={`translate(${x} ${y})`}
    />
  );
}
