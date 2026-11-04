import type { StyleSpecification } from 'maplibre-gl';

export type BasemapProvider = 'openfreemap' | 'tianditu';
export interface BasemapPreferences {
  provider: BasemapProvider;
  tiandituKey: string;
  enabled: boolean;
}
export type BasemapFailure = 'unavailable' | 'access' | 'quota' | 'graphics' | 'timeout';

const storageKey = 'route-studio-basemap';
const defaults: BasemapPreferences = { provider: 'openfreemap', tiandituKey: '', enabled: true };

export function loadBasemapPreferences(): BasemapPreferences {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (value && typeof value === 'object') {
      const saved = value as Record<string, unknown>;
      return {
        provider: saved.provider === 'tianditu' ? 'tianditu' : 'openfreemap',
        tiandituKey: typeof saved.tiandituKey === 'string' ? saved.tiandituKey.trim() : '',
        enabled: typeof saved.enabled === 'boolean' ? saved.enabled : true,
      };
    }
  } catch {
    // Local preferences are optional; never include stored credentials in diagnostics.
  }
  return { ...defaults };
}

export function saveBasemapPreferences(preferences: BasemapPreferences): boolean {
  try {
    localStorage.setItem(storageKey, JSON.stringify(preferences));
    return true;
  } catch {
    return false;
  }
}

export function basemapStyle(preferences: BasemapPreferences): string | StyleSpecification {
  if (preferences.provider === 'openfreemap')
    return import.meta.env.VITE_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty';

  const tiles = (layer: 'vec' | 'cva') =>
    Array.from(
      { length: 8 },
      (_, node) =>
        `https://t${node}.tianditu.gov.cn/${layer}_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${encodeURIComponent(preferences.tiandituKey)}`,
    );
  return {
    version: 8,
    sources: {
      tianditu: {
        type: 'raster',
        tiles: tiles('vec'),
        tileSize: 256,
        minzoom: 1,
        maxzoom: 18,
        attribution: '<a href="https://www.tianditu.gov.cn/" target="_blank" rel="noopener">天地图</a>',
      },
      'tianditu-labels': {
        type: 'raster',
        tiles: tiles('cva'),
        tileSize: 256,
        minzoom: 1,
        maxzoom: 18,
      },
    },
    layers: [
      { id: 'tianditu', type: 'raster', source: 'tianditu' },
      { id: 'tianditu-labels', type: 'raster', source: 'tianditu-labels' },
    ],
  };
}

export function classifyBasemapFailure(error: unknown): BasemapFailure {
  const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
  if (status === 401 || status === 403) return 'access';
  if (status === 429) return 'quota';
  return 'unavailable';
}
