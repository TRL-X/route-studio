import { afterEach, expect, it, vi } from 'vitest';
import { loadBasemapPreferences, saveBasemapPreferences } from '../../src/maps/basemap';

afterEach(() => vi.unstubAllGlobals());

it('recovers safely from corrupted or unavailable local settings', () => {
  for (const saved of ['broken JSON', 'null', '[]', '{"provider":"unknown","enabled":"false"}']) {
    vi.stubGlobal('localStorage', { getItem: () => saved });
    expect(loadBasemapPreferences()).toEqual({ provider: 'openfreemap', enabled: true, tiandituKey: '' });
  }
  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw new Error('Storage blocked');
    },
    setItem: () => {
      throw new Error('Storage blocked');
    },
  });
  const defaults = loadBasemapPreferences();
  expect(defaults.provider).toBe('openfreemap');
  expect(saveBasemapPreferences(defaults)).toBe(false);
});

it('does not substitute another provider when a saved Tianditu Key is missing', () => {
  vi.stubGlobal('localStorage', {
    getItem: () => JSON.stringify({ provider: 'tianditu', enabled: true, tiandituKey: null }),
  });
  expect(loadBasemapPreferences()).toEqual({ provider: 'tianditu', enabled: true, tiandituKey: '' });
});
