import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { loadProject, saveProject } from '../../src/files';
import { loadDraft, saveDraft } from '../../src/platform/storage/draft';
import { emptyRoute, type RouteDocument } from '../../src/domain/model';

const doc: RouteDocument = {
  name: 'Mountain loop 🏔',
  elevationReference: 0,
  vertices: [
    { id: 'v0', lat: 10, lon: 20 },
    { id: 'v1', lat: 10.5, lon: 20.5 },
  ],
  elevation: [{ anchor: { vertexId: 'v0', fraction: 0.25 }, height: null }],
  stations: [{ id: 's', name: '', kind: 'cp', boundary: true, anchor: null }],
  rte: { distanceDm: [0, 5000], indexBlockSizes: [2] },
};

describe('versioned route projects', () => {
  it('round trips incomplete documents, independent samples and RTE context', () => {
    expect(loadProject(saveProject(doc))).toEqual(doc);
    expect(loadProject(saveProject(emptyRoute()))).toEqual(emptyRoute());
  });
  it.each([
    { mode: 'unexpected' },
    { mode: 'manual', degrees: '0' },
    { mode: 'auto', source: 'BGS WMM2025', date: '2026-11-03', result: {} },
    {
      mode: 'auto',
      source: 'BGS WMM2025',
      date: '2026-11-03',
      result: {
        declinationCdeg: 0,
        referenceLatE7: 0,
        referenceLonE7: 0,
        referenceDate: '2026-11-01',
      },
    },
  ])('rejects invalid saved declination settings', (settings) => {
    const file = JSON.parse(saveProject(doc));
    file.document.declination = settings;
    expect(() => loadProject(JSON.stringify(file))).toThrowError(
      expect.objectContaining({ code: 'invalid-project' }),
    );
  });
  it('distinguishes unsupported project versions from malformed data', () => {
    const file = JSON.parse(saveProject(doc));
    expect(() => loadProject(JSON.stringify({ ...file, version: 2 }))).toThrowError(
      expect.objectContaining({ code: 'project-version' }),
    );
    expect(() => loadProject('{')).toThrowError(expect.objectContaining({ code: 'invalid-project' }));
  });
  it.each([
    (value: RouteDocument) => {
      value.vertices[0].lon = 190;
    },
    (value: RouteDocument) => {
      value.vertices[1].id = 'v0';
    },
    (value: RouteDocument) => {
      value.stations[0].anchor = { vertexId: 'missing', fraction: 0 };
    },
    (value: RouteDocument) => {
      value.elevation[0].anchor = { vertexId: 'v1', fraction: 0.5 };
    },
    (value: RouteDocument) => {
      value.rte!.distanceDm = [0, 0];
    },
  ])('rejects structurally invalid project contents', (edit) => {
    const file = JSON.parse(saveProject(doc));
    edit(file.document);
    expect(() => loadProject(JSON.stringify(file))).toThrowError(
      expect.objectContaining({ code: 'invalid-project' }),
    );
  });
});

describe('browser draft recovery', () => {
  it('recovers the last committed edit even for overlapping writes', async () => {
    expect(await loadDraft()).toBeNull();
    const latest = { doc: { ...doc, name: 'Latest' }, backedUp: false };
    await Promise.all([saveDraft({ doc, backedUp: true }), saveDraft(latest)]);
    expect(await loadDraft()).toEqual(latest);
    await saveDraft({ ...latest, backedUp: true });
    expect(await loadDraft()).toEqual({ ...latest, backedUp: true });
  });

  it('recovers an older draft without assuming that a project file was saved', async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('route-studio', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('drafts');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const transaction = db.transaction('drafts', 'readwrite');
        transaction.objectStore('drafts').put(saveProject(doc), 'current');
        transaction.onabort = () => reject(transaction.error);
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
      };
    });
    expect(await loadDraft()).toEqual({ doc, backedUp: false });
  });
});
