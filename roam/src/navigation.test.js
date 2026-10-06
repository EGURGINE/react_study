import test from "node:test";
import assert from "node:assert/strict";
import { findPath } from "./navigation.js";

function assertClearRoute(
  start,
  path,
  colliders,
  { radius = 13.35, clearance = 0.75 } = {},
) {
  assert.ok(path.length > 0, "route must contain a destination");
  let previous = start;
  for (const point of path) {
    const lengthSquared =
      (point.x - previous.x) ** 2 + (point.z - previous.z) ** 2;
    assert.ok(
      Math.hypot(point.x, point.z) <= radius + 1e-7,
      "waypoint must remain on the island",
    );
    for (const obstacle of colliders) {
      const dx = point.x - previous.x;
      const dz = point.z - previous.z;
      const projection = lengthSquared
        ? ((obstacle.x - previous.x) * dx + (obstacle.z - previous.z) * dz) /
          lengthSquared
        : 0;
      const t = Math.max(0, Math.min(1, projection));
      const separation = Math.hypot(
        previous.x + t * dx - obstacle.x,
        previous.z + t * dz - obstacle.z,
      );
      assert.ok(
        separation >= obstacle.r + clearance - 1e-7,
        `route cuts an obstacle: ${separation}`,
      );
    }
    previous = point;
  }
}

test("unobstructed clicks take a direct route without grid detours", () => {
  const start = { x: -3.3, z: 1.1 };
  const target = { x: 4.7, z: -2.6 };
  assert.deepEqual(findPath(start, target, [{ x: 8, z: 8, r: 1 }]), [target]);
  assert.deepEqual(findPath(start, start, []), []);
});

test("routes around overlapping obstacles and keeps exact segment clearance", () => {
  const start = { x: -9, z: 0 };
  const target = { x: 9, z: 0 };
  const colliders = [
    { x: 0, z: 0, r: 2 },
    { x: 0.5, z: 2.2, r: 1.5 },
    { x: -2, z: -1, r: 1 },
  ];
  const path = findPath(start, target, colliders);
  assert.ok(path.length >= 2);
  assert.deepEqual(path.at(-1), target);
  assertClearRoute(start, path, colliders);
});

test("clicks inside an obstacle snap to nearby free ground", () => {
  const start = { x: -7, z: 1 };
  const target = { x: 0.4, z: 0.2 };
  const colliders = [{ x: 0, z: 0, r: 2 }];
  const path = findPath(start, target, colliders);
  assertClearRoute(start, path, colliders);
  assert.ok(Math.hypot(path.at(-1).x, path.at(-1).z) < 2.76);
  assert.ok(
    Math.hypot(path.at(-1).x - target.x, path.at(-1).z - target.z) < 2.31,
  );
});

test("outside clicks clamp to the island boundary and obstacle detours stay inside", () => {
  const start = { x: -8, z: 2 };
  const target = { x: 100, z: 50 };
  const colliders = [
    { x: 0, z: 1, r: 2.5 },
    { x: 6, z: 3, r: 2 },
  ];
  const path = findPath(start, target, colliders);
  assertClearRoute(start, path, colliders);
  assert.ok(Math.abs(Math.hypot(path.at(-1).x, path.at(-1).z) - 13.35) < 1e-7);
});

test("overlapping obstacle targets snap to the nearest free boundary intersection", () => {
  const start = { x: -8, z: 0 };
  const colliders = [
    { x: -1, z: 0, r: 1.5 },
    { x: 1, z: 0, r: 1.5 },
  ];
  const path = findPath(start, { x: 0, z: 0 }, colliders);
  assertClearRoute(start, path, colliders);
  const nearestDistance = Math.sqrt(2.25 ** 2 - 1);
  assert.ok(
    Math.abs(Math.hypot(path.at(-1).x, path.at(-1).z) - nearestDistance) < 1e-6,
  );
});

test("an obstacle wall joining island edges makes the far side unreachable", () => {
  const colliders = Array.from({ length: 15 }, (_, index) => ({
    x: 0,
    z: index * 2 - 14,
    r: 0.8,
  }));
  assert.deepEqual(findPath({ x: -5, z: 0 }, { x: 5, z: 0 }, colliders), []);
});

test("thin obstacles between grid nodes cannot be cut through", () => {
  const start = { x: -4, z: 0 };
  const target = { x: 4, z: 0 };
  const colliders = [{ x: 0.3, z: 0, r: 0.03 }];
  const options = { radius: 6, clearance: 0.1, step: 2 };
  assertClearRoute(
    start,
    findPath(start, target, colliders, options),
    colliders,
    options,
  );
});

test("a start inside the safety margin can escape only by moving away", () => {
  const start = { x: -1.6, z: 0 };
  const colliders = [{ x: 0, z: 0, r: 1 }];
  const path = findPath(start, { x: 5, z: 0 }, colliders);
  assert.ok(path.length > 1);
  assert.ok(
    path[0].x <= start.x + 1e-7,
    "first motion must move away from the obstacle",
  );
  assertClearRoute(path[0], path.slice(1), colliders);
});

test("very small grid steps remain bounded and invalid inputs return no route", () => {
  const start = { x: -4, z: 0 };
  const target = { x: 4, z: 0 };
  const colliders = [{ x: 0, z: 0, r: 1 }];
  assertClearRoute(
    start,
    findPath(start, target, colliders, { step: 1e-12 }),
    colliders,
  );
  assert.deepEqual(findPath({ x: NaN, z: 0 }, target, []), []);
  assert.deepEqual(findPath(start, target, [], { step: 0 }), []);
  assert.deepEqual(findPath({ x: 20, z: 0 }, target, []), []);
  assert.deepEqual(findPath({ x: 0, z: 0 }, target, colliders), []);
});
