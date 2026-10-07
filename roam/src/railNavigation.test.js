import test from "node:test";
import assert from "node:assert/strict";
import { findWorldPath } from "./railNavigation.js";
import {
  isDriveable,
  trackPoint,
  projectTrack,
  DUEL_TRACK,
  duelStart,
  projectDuel,
  CONNECTOR,
} from "./gameConfig.js";

function validateRoute(start, path, colliders = []) {
  assert.ok(path.length, "destination must be reachable");
  let previous = start;
  for (const next of path) {
    const length = Math.hypot(next.x - previous.x, next.z - previous.z);
    const count = Math.max(1, Math.ceil(length / 0.04));
    for (let index = 0; index <= count; index++) {
      const x = previous.x + ((next.x - previous.x) * index) / count;
      const z = previous.z + ((next.z - previous.z) * index) / count;
      assert.ok(isDriveable(x, z), `route leaves visible ground at ${x},${z}`);
      for (const obstacle of colliders)
        assert.ok(
          Math.hypot(x - obstacle.x, z - obstacle.z) >= obstacle.r + 0.81,
          "route crosses an island obstacle",
        );
    }
    previous = next;
  }
}

test("island-to-rail routes use the connector and avoid static obstacles", () => {
  const start = { x: 1.3, z: 7.8 };
  const target = trackPoint(0.62);
  const colliders = [{ x: 0, z: 14, r: 2 }];
  const path = findWorldPath(start, target, colliders);
  validateRoute(start, path, colliders);
  assert.ok(
    path.some(
      (point) => point.z > 22 && point.z < 27 && Math.abs(point.x) <= 2.2,
    ),
  );
  assert.ok(
    Math.hypot(path.at(-1).x - target.x, path.at(-1).z - target.z) < 0.01,
  );
});

test("rail-to-island routes return through the bridge without cutting the hole", () => {
  const start = trackPoint(0.3);
  const target = { x: -7, z: 3 };
  validateRoute(start, findWorldPath(start, target));
});

test("rail routes always follow the lap direction, including wraparound", () => {
  const start = trackPoint(0.1);
  const path = findWorldPath(start, trackPoint(0.05));
  validateRoute(start, path);
  let previous = 0.1;
  let traveled = 0;
  for (const point of path) {
    const progress = projectTrack(point.x, point.z).progress;
    const delta = (progress - previous + 1) % 1;
    assert.ok(
      delta < 0.025 || Math.abs(delta - 1) < 1e-8,
      "waypoints must progress forward",
    );
    if (delta < 0.5) traveled += delta;
    previous = progress;
  }
  assert.ok(Math.abs(traveled - 0.95) < 0.001);
});

test("clicks in the track hole snap onto the nearest rail", () => {
  const start = trackPoint(0.2);
  const path = findWorldPath(start, { x: 0, z: 34 });
  validateRoute(start, path);
  assert.ok(projectTrack(path.at(-1).x, path.at(-1).z).distance < 0.001);
});

test("bridge starts and destinations remain inside its deck", () => {
  const start = { x: 1.9, z: 24 };
  validateRoute(start, findWorldPath(start, trackPoint(0.25)));
  const railStart = trackPoint(0.75);
  const bridgeEnd = { x: -1.9, z: 24.5 };
  validateRoute(railStart, findWorldPath(railStart, bridgeEnd));
});

test("wide bridge edges are reachable from side approaches without cutting across the water", () => {
  for (const side of [-1, 1]) {
    const shore = { x: side * 8, z: 19.5 };
    const edge = { x: side * (CONNECTOR.halfWidth - 0.15), z: 24 };
    validateRoute(shore, findWorldPath(shore, edge));
    validateRoute(edge, findWorldPath(edge, shore));
    const rail = trackPoint(side < 0 ? 0.73 : 0.23);
    validateRoute(edge, findWorldPath(edge, rail));
    validateRoute(rail, findWorldPath(rail, edge));
    const oppositeEdge = { x: -edge.x, z: 25.5 };
    validateRoute(edge, findWorldPath(edge, oppositeEdge));
  }
});

test("clicking side water snaps to the rail while the route still uses the bridge", () => {
  const start = { x: 8, z: 19.5 };
  const target = { x: 8, z: 24.5 };
  assert.equal(isDriveable(target.x, target.z), false);
  const path = findWorldPath(start, target);
  validateRoute(start, path);
  assert.ok(projectTrack(path.at(-1).x, path.at(-1).z).distance < 1e-8);
  assert.ok(
    path.some(
      (point) =>
        point.z > 22 &&
        point.z < 27 &&
        Math.abs(point.x) <= CONNECTOR.halfWidth,
    ),
  );
});

test("invalid and distant off-map destinations are rejected", () => {
  assert.deepEqual(findWorldPath({ x: 0, z: 0 }, { x: NaN, z: 29 }), []);
  assert.deepEqual(findWorldPath({ x: 0, z: 0 }, { x: 45, z: 40 }), []);
  assert.deepEqual(findWorldPath({ x: 0, z: 34 }, { x: 0, z: 29 }), []);
});

test("the separate duel course supports a straight route on either lane", () => {
  for (const lane of [0, 1]) {
    const start = duelStart(lane);
    const finish = { x: start.x, z: DUEL_TRACK.finishZ };
    const path = findWorldPath(start, finish);
    assert.deepEqual(path, [finish]);
    validateRoute(start, path);
    assert.equal(projectDuel(path.at(-1).x, path.at(-1).z).progress, 1);
  }
});

test("navigation never invents a road between the disconnected duel and island", () => {
  const duel = duelStart(0);
  for (const other of [{ x: 0, z: 0 }, { x: 0, z: 24 }, trackPoint(0.4)]) {
    assert.deepEqual(findWorldPath(duel, other), []);
    assert.deepEqual(findWorldPath(other, duel), []);
  }
});

test("duel end padding is reachable but off-course clicks are rejected", () => {
  const start = duelStart(1);
  const padding = { x: DUEL_TRACK.cx + 2.5, z: DUEL_TRACK.finishZ - 3 };
  validateRoute(start, findWorldPath(start, padding));
  assert.deepEqual(findWorldPath(start, { x: DUEL_TRACK.cx + 4, z: 0 }), []);
});
