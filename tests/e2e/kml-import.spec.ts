import { selectOption } from '../controls';
import { expect, test } from '@playwright/test';
import { loadProject } from '../../src/files/project';
import { download, open } from './files';

test('opens a KML route with inherited heights and leaves other routes’ landmarks unassigned', async ({
  page,
}) => {
  const kml = `<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
    <Document>
      <Folder><name>A</name>
        <Placemark><name>Route A</name><gx:MultiTrack><altitudeMode>absolute</altitudeMode>
          <gx:Track><when>2026-01-01T00:00:00Z</when><when>2026-01-01T00:01:00Z</when>
            <gx:coord>120 30 100</gx:coord><gx:coord>120.01 30 120</gx:coord>
          </gx:Track>
        </gx:MultiTrack></Placemark>
        <Placemark><name>Water A</name><Point><coordinates>120.005,30</coordinates></Point></Placemark>
      </Folder>
      <Folder><name>B</name>
        <Placemark><name>Route B</name><LineString><coordinates>120,31 120.01,31</coordinates></LineString></Placemark>
        <Placemark><name>Water B</name><Point><coordinates>120.005,31</coordinates></Point></Placemark>
      </Folder>
    </Document>
  </kml>`;
  await page.goto('/');
  await open(page, 'routes.kml', Buffer.from(kml));
  const dialog = page.getByRole('dialog', { name: 'Choose a route to open' });
  await selectOption(dialog.getByRole('combobox'), '0');
  await expect(dialog.getByRole('checkbox', { name: 'Use the altitude values in this KML' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Route A', exact: true })).toBeVisible();

  const doc = loadProject((await download(page, 'Save project')).bytes.toString('utf8'));
  expect(doc.elevationReference).toBe(1);
  expect(doc.elevation.map((sample) => sample.height)).toEqual([100, 120]);
  expect(doc.stations.find((station) => station.name === 'Water A')).toMatchObject({
    kind: 'cp',
    boundary: true,
    anchor: { fraction: expect.closeTo(0.5) },
  });
  expect(doc.stations.find((station) => station.name === 'Water B')).toMatchObject({
    kind: 'poi',
    boundary: false,
    anchor: null,
    location: { lat: 31, lon: 120.005 },
  });
});
