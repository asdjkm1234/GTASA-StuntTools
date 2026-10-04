import { describe, expect, it } from 'vitest';

import type { CameraStateOut } from './camera';
import type { FlightTrack } from './csv';
import type { Vec3 } from './math';

import { parseFlightCsv } from './csv';
import { pickFlightRoute } from './route-picking';

const camera: CameraStateOut = {
  aspect: 1,
  eye: [0, 0, 0],
  far: 100,
  fovYRad: Math.PI / 2,
  near: 1,
  target: [0, 0, -1],
  up: [0, 1, 0],
};
function track(points: Vec3[], seconds = points.map((_, i) => i * 10)): FlightTrack {
  return parseFlightCsv(
    [
      'local_timestamp,model,health,x,y,z,capture_elapsed_s',
      ...points.map(([x, y, z], i) => `2026-10-03T00:00:00.000,520,1000,${x},${-z},${y},${seconds[i]}`),
    ].join('\n'),
    'route.csv',
  );
}
const options = { height: 100, width: 100, x: 50, y: 50 };

describe('route click capture-time picking', () => {
  it('interpolates exact time along a segment and uses a CSS-pixel hit tolerance', () => {
    const flight = track(
      [
        [-2, 0, -10],
        [2, 0, -10],
      ],
      [10, 20],
    );
    const hit = pickFlightRoute(flight, camera, { ...options, x: 55, y: 55 });
    expect(hit?.seconds).toBeCloseTo(17.5, 5);
    expect(hit?.distancePx).toBeCloseTo(5);
    expect(hit?.segmentIndex).toBe(0);
    expect(pickFlightRoute(flight, camera, { ...options, y: 59 })).toBeNull();
    // Doubling CSS viewport size preserves the selected capture time.
    expect(
      pickFlightRoute(flight, camera, { ...options, height: 200, width: 200, x: 110, y: 100 })?.seconds,
    ).toBeCloseTo(17.5, 5);
  });

  it('corrects perspective: the screen midpoint can be only 20% along the flight', () => {
    const flight = track([
      [-2, 0, -5],
      [8, 0, -20],
    ]);
    const hit = pickFlightRoute(flight, camera, options);
    expect(hit?.seconds).toBeCloseTo(2, 5);
    expect(hit?.depth).toBeCloseTo(8, 5);
  });

  it('picks visible portions crossing the viewport or the near plane', () => {
    expect(
      pickFlightRoute(
        track([
          [-40, 0, -10],
          [40, 0, -10],
        ]),
        camera,
        options,
      )?.seconds,
    ).toBeCloseTo(5, 5); // Both endpoints are outside.
    expect(
      pickFlightRoute(
        track([
          [-2, 0, 1],
          [2, 0, -10],
        ]),
        camera,
        options,
      )?.seconds,
    ).toBeCloseTo(5, 5); // The first endpoint is behind the camera.
  });

  it('rejects hidden, invalid, stationary and zero-time segments and invalid clicks', () => {
    for (const flight of [
      track([
        [-2, 0, 5],
        [2, 0, 5],
      ]),
      track([
        [-2, 0, -200],
        [2, 0, -200],
      ]),
      track([
        [0, 0, -10],
        [0, 0, -10],
      ]),
      track(
        [
          [-2, 0, -10],
          [2, 0, -10],
        ],
        [0, 0],
      ),
    ])
      expect(pickFlightRoute(flight, camera, options)).toBeNull();
    const flight = track([
      [-2, 0, -10],
      [2, 0, -10],
    ]);
    flight.rows[1].pos[0] = NaN;
    expect(pickFlightRoute(flight, camera, options)).toBeNull();
    for (const change of [{ width: 0 }, { radiusPx: -1 }, { x: -1 }, { y: 101 }, { x: NaN }])
      expect(
        pickFlightRoute(
          track([
            [-2, 0, -10],
            [2, 0, -10],
          ]),
          camera,
          { ...options, ...change },
        ),
      ).toBeNull();
  });

  it('prefers the nearer 3D branch at a crossing and the current pass on an identical retrace', () => {
    const crossing = track([
      [-4, 0, -20],
      [4, 0, -20],
      [0, -2, -10],
      [0, 2, -10],
    ]);
    expect(pickFlightRoute(crossing, camera, options)?.segmentIndex).toBe(2);
    const retrace = track([
      [-2, 0, -10],
      [2, 0, -10],
      [-2, 0, -10],
    ]);
    expect(pickFlightRoute(retrace, camera, { ...options, currentSeconds: 4 })?.seconds).toBeCloseTo(5);
    expect(pickFlightRoute(retrace, camera, { ...options, currentSeconds: 16 })?.seconds).toBeCloseTo(15);
  });

  it('handles a path aligned with the camera and chooses the nearer endpoint', () => {
    const flight = track([
      [0, 0, -20],
      [0, 0, -5],
    ]);
    expect(pickFlightRoute(flight, camera, options)?.seconds).toBe(10);
  });
});
