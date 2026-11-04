import { type RouteDocument } from '../../src/domain/model';

/** Synthetic route data for geometry, profile, and editor tests. */
export function ridgeRoute(): RouteDocument {
  const path = [
    [7.392, 46.012, 1020],
    [7.398, 46.015, 1080],
    [7.403, 46.014, 1120],
    [7.409, 46.018, 1210],
    [7.414, 46.017, 1265],
    [7.417, 46.022, 1370],
    [7.425, 46.025, 1490],
    [7.426, 46.029, 1530],
    [7.433, 46.03, 1520],
    [7.438, 46.035, 1635],
    [7.446, 46.037, 1700],
    [7.451, 46.034, 1650],
    [7.457, 46.035, 1580],
    [7.462, 46.031, 1500],
    [7.469, 46.032, 1450],
    [7.476, 46.029, 1390],
    [7.481, 46.03, 1330],
    [7.485, 46.026, 1250],
    [7.492, 46.025, 1190],
    [7.497, 46.027, 1150],
    [7.502, 46.024, 1100],
    [7.508, 46.025, 1080],
    [7.514, 46.022, 1050],
  ];
  const vertices = path.map(([lon, lat], i) => ({ lon, lat, id: 'v' + i }));
  const anchor = (i: number) => ({ vertexId: vertices[i].id, fraction: 0 });
  return {
    name: 'Ridgeline Traverse',
    vertices,
    elevationReference: 1,
    elevation: path.map((p, i) => ({ anchor: anchor(i), height: p[2] })),
    stations: [
      { id: '1', kind: 'start', name: 'Trailhead', boundary: true, anchor: anchor(0) },
      { id: '2', kind: 'cp', name: 'Ridge Pass', shortLabel: 'CP1', boundary: true, anchor: anchor(10) },
      { id: '3', kind: 'poi', name: 'Lookout', boundary: false, anchor: anchor(16) },
      { id: '4', kind: 'finish', name: 'Valley Gate', boundary: true, anchor: anchor(path.length - 1) },
    ],
  };
}
