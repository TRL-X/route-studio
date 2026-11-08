import { describe, it, expect } from 'vitest';
import { parseFitRoutes } from '../../src/files/fit';
import { file, indoorActivity, multisportActivity, outAndBackCourse } from './fit-fixtures';

const parse = (bytes: Uint8Array) => parseFitRoutes(Uint8Array.from(bytes).buffer, 'trail.FIT');

describe('FIT import', () => {
  it('maps course cues to recorded visits and merges stationary fixes without losing timestamp matches', async () => {
    const [choice] = await parse(outAndBackCourse());
    expect(choice).toMatchObject({ name: '山脊', pointCount: 3, hasUnconfirmedHeights: false });
    const doc = choice.open();
    expect(doc.vertices.map((v) => v.lon)).toEqual([0, expect.closeTo(1, 6), 0]);
    expect(doc.elevation.map((s) => s.height)).toEqual([0, 10, null]);
    expect(doc.elevationReference).toBe(0);
    const turnaround = doc.vertices[1].id;
    expect(doc.stations).toMatchObject([
      { kind: 'start' },
      {
        name: 'Turnaround',
        kind: 'poi',
        anchor: { vertexId: turnaround, fraction: 0 },
        location: { lat: expect.closeTo(-0.01, 6), lon: expect.closeTo(1, 6) },
      },
      {
        name: '返回 CP',
        kind: 'cp',
        boundary: true,
        anchor: { vertexId: turnaround, fraction: expect.closeTo(0.5, 6) },
      },
      { name: 'Both visits', anchor: null, location: { lat: 0, lon: expect.closeTo(0.5, 6) } },
      { kind: 'finish' },
    ]);
  });

  it.each([
    { when: 'at each session end', summaryTime: undefined },
    { when: 'before the session ends', summaryTime: 0 },
    { when: 'after the session ends', summaryTime: 30 },
  ])('uses elapsed time when summaries are written $when', async ({ summaryTime }) => {
    const choices = await parse(multisportActivity({ summaryTime }));
    expect(choices.map((c) => c.name)).toEqual(['trail (1, running)', 'trail (2, cycling)']);
    expect(choices.map((c) => c.pointCount)).toEqual([2, 2]);
    // Exclude fixes outside the sessions; the shared 10-second fix belongs only to cycling.
    expect(choices.map((c) => c.open().vertices.map((v) => v.lat))).toEqual([
      [0, expect.closeTo(0.01, 6)],
      [expect.closeTo(2, 6), expect.closeTo(2.01, 6)],
    ]);
  });

  it('uses only the session number when sport is absent', async () => {
    const choices = await parse(multisportActivity({ omitSport: true }));
    expect(choices.map((c) => c.name)).toEqual(['trail (1)', 'trail (2)']);
  });

  it('keeps the timestamp fallback for legacy session summaries without elapsed time', async () => {
    const choices = await parse(multisportActivity({ omitElapsedTime: true }));
    expect(choices.map((c) => c.pointCount)).toEqual([2, 2]);
    expect(choices[1].open().vertices.at(-1)?.lat).toBeCloseTo(2.01, 6);
  });

  it('rejects damaged, truncated, unsupported and GPS-free files', async () => {
    const bytes = multisportActivity();
    await expect(parse(bytes.slice(0, -2))).rejects.toMatchObject({ code: 'invalid-fit' });
    bytes[bytes.length - 1] ^= 0xff;
    await expect(parse(bytes)).rejects.toMatchObject({ code: 'invalid-fit' });
    await expect(parse(file(5).close())).rejects.toMatchObject({ code: 'unsupported-fit-type' });
    await expect(parse(indoorActivity())).rejects.toMatchObject({ code: 'fit-no-gps' });
  });
});
