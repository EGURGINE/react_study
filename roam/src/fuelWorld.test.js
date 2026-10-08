import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  createFuelWorld,
  createFuelPrediction,
  fuelProximity,
  blocksGarageApproach,
} from "./fuelWorld.js";
import {
  FUEL,
  garagePoint,
  garageDoorContact,
  isGarageDriveable,
  garageWallSegments,
} from "./fuelConfig.js";
import { findWorldPath } from "./railNavigation.js";
import { isDriveable } from "./gameConfig.js";

test("tank prediction preserves unacknowledged drain, accepts refilling and ignores stale state", () => {
  const prediction = createFuelPrediction();
  prediction.reconcile({ id: "me", tank: 100 }, 1000, 1000);
  for (let now = 1100; now <= 1500; now += 100)
    prediction.consume(0.1, 10, true, true, now);
  assert.equal(prediction.tank, 95);
  prediction.reconcile({ id: "me", tank: 97 }, 1300, 1500);
  assert.equal(
    prediction.tank,
    95,
    "delayed authority must not re-add two predicted units",
  );
  prediction.reconcile({ id: "me", tank: 99 }, 1100, 1550);
  assert.equal(prediction.tank, 95);
  assert.equal(
    prediction.consume(0.1, 10, true, false, 1560),
    false,
    "stationary Shift costs nothing",
  );
  assert.equal(
    prediction.consume(0.1, 10, false, true, 1570),
    false,
    "physical boost pads cost nothing",
  );
  prediction.reconcile({ id: "me", tank: 100 }, 1600, 1600);
  assert.equal(prediction.tank, 100, "server pump refill is accepted");
  prediction.consume(NaN, 10, true, true, 1601);
  assert.equal(prediction.tank, 100);
  prediction.reconcile(null, 1700, 1700);
  assert.equal(prediction.tank, 0);
  assert.equal(
    prediction.consume(0.1, 10, true, true, 1800),
    false,
    "offline has no manual boost fuel",
  );
});

function validateRoute(start, path, garages, playerId, now) {
  assert.ok(path.length, "occupied garage must be reachable");
  let previous = start;
  for (const next of path) {
    const steps = Math.max(
      1,
      Math.ceil(Math.hypot(next.x - previous.x, next.z - previous.z) / 0.02),
    );
    for (let index = 0; index <= steps; index++) {
      const x = previous.x + ((next.x - previous.x) * index) / steps;
      const z = previous.z + ((next.z - previous.z) * index) / steps;
      assert.ok(
        isDriveable(x, z) ||
          garages.some((garage) => isGarageDriveable(x, z, garage.slot)),
        `left deck at ${x},${z}`,
      );
    }
    assert.ok(
      garages.every(
        (garage) => !garageDoorContact(previous, next, garage, playerId, now),
      ),
      "route crosses a locked gate",
    );
    previous = next;
  }
}

test("all ten occupied garages route through bridges in both directions; closed doors reject visitors", () => {
  const start = { x: 1.3, z: 7.8 };
  const garages = Array.from({ length: 10 }, (_, slot) => ({
    slot,
    ownerId: `owner-${slot}`,
    closedUntil: 0,
  }));
  for (const garage of garages) {
    const target = garagePoint(garage.slot, 0, -0.95);
    const options = { garages, playerId: garage.ownerId, now: 1000 };
    validateRoute(
      start,
      findWorldPath(start, target, [], options),
      garages,
      garage.ownerId,
      1000,
    );
    validateRoute(
      target,
      findWorldPath(target, start, [], options),
      garages,
      garage.ownerId,
      1000,
    );
    assert.deepEqual(
      findWorldPath(start, target),
      [],
      "an empty slot must not invent a bridge",
    );
    garage.closedUntil = 31000;
    validateRoute(
      start,
      findWorldPath(start, target, [], options),
      garages,
      garage.ownerId,
      1000,
    );
    assert.deepEqual(
      findWorldPath(start, target, [], { ...options, playerId: "visitor" }),
      [],
    );
    garage.closedUntil = 0;
  }
  const from = garagePoint(0, 0, -0.9),
    to = garagePoint(9, 0, -0.9);
  validateRoute(
    from,
    findWorldPath(from, to, [], { garages, playerId: "visitor", now: 1000 }),
    garages,
    "visitor",
    1000,
  );
});

test("pump proximity and clearing the approach agree with occupied garage geometry", () => {
  const garage = {
    slot: 4,
    ownerId: "friend",
    nickname: "친구",
    stored: 80,
    closedUntil: 2000,
  };
  const position = garagePoint(garage.slot, 0, -0.95);
  const nearby = fuelProximity({ garages: [garage] }, "me", position, 1000);
  assert.equal(nearby.nearTheft.ownerId, "friend");
  assert.equal(nearby.nearTheft.closed, true);
  assert.ok(nearby.nearTheft.distance < FUEL.proximity);
  assert.equal(
    fuelProximity({ garages: [garage] }, "friend", position, 1000).nearOwnPump,
    true,
  );
  assert.equal(
    fuelProximity({ garages: [garage] }, "me", { x: 0, z: 0 }, 1000).nearTheft,
    null,
  );
  const tree = { ...garagePoint(4, 0.3, -4), r: 0.6, model: {} };
  assert.equal(blocksGarageApproach(tree, [garage]), true);
  assert.equal(blocksGarageApproach(tree, []), false);
  assert.equal(
    blocksGarageApproach({ ...tree, model: undefined }, [garage]),
    false,
    "never remove unrelated permanent buildings",
  );
});

test("garage, dropped fuel and moving cargo reuse geometry and release owned resources", () => {
  const scene = new THREE.Scene(),
    world = createFuelWorld(scene);
  const car = new THREE.Group();
  car.position.set(2, 0, 3);
  const cars = new Map([["me", car]]);
  const snapshot = {
    garages: [
      {
        ownerId: "me",
        nickname: "나",
        slot: 0,
        stored: 40,
        closedUntil: 30000,
      },
    ],
    players: [{ id: "me", carrying: { amount: 25 } }],
    drops: [{ id: "drop", x: 2, z: 4 }],
  };
  world.setFuel(snapshot, "me");
  world.update(1000, cars, 0.5);
  const resources = () => {
    const geoms = new Set(),
      mats = new Set();
    scene.traverse((object) => {
      if (object.geometry) geoms.add(object.geometry);
      if (object.material) mats.add(object.material);
    });
    return { geoms, mats };
  };
  const initial = resources();
  for (let index = 0; index < 150; index++) {
    car.position.x = index * 0.1;
    world.setFuel(
      {
        ...snapshot,
        garages: [{ ...snapshot.garages[0], stored: index % 100 }],
      },
      "me",
    );
    world.update(1000 + index * 16, cars, 0.8);
  }
  const after = resources();
  assert.deepEqual(after.geoms, initial.geoms);
  assert.deepEqual(after.mats, initial.mats);
  const root = scene.getObjectByName("personal-garages");
  assert.equal(root.children.length, 3);
  const cargo = root.children.find((child) => child.position.y === 1.78);
  assert.equal(
    cargo.position.x,
    car.position.x,
    "cargo follows the rendered pose without network steps",
  );
  let disposed = 0;
  for (const resource of [...after.geoms, ...after.mats])
    resource.addEventListener("dispose", () => disposed++);
  world.dispose();
  assert.equal(scene.children.length, 0);
  assert.equal(disposed, after.geoms.size + after.mats.size);
  world.dispose();
  assert.equal(disposed, after.geoms.size + after.mats.size);
});

test("enlarged garages draw the exact shared perimeter as one instanced wall and release its buffers", () => {
  const scene = new THREE.Scene(),
    world = createFuelWorld(scene);
  const garages = Array.from({ length: FUEL.slots }, (_, slot) => ({
    slot,
    ownerId: `owner-${slot}`,
    nickname: `친구${slot}`,
    stored: 20,
    closedUntil: 0,
  }));
  world.setFuel({ garages, players: [], drops: [] }, "owner-0");
  world.update(1000, new Map());
  scene.updateMatrixWorld(true);
  const matrix = new THREE.Matrix4(),
    position = new THREE.Vector3(),
    scale = new THREE.Vector3(),
    rotation = new THREE.Quaternion();
  const renderedInstances = [];
  for (const garage of garages) {
    const group = scene.getObjectByName(`personal-garage-${garage.ownerId}`);
    const floor = group.getObjectByName("garage-floor"),
      walls = group.getObjectByName("garage-boundary-walls");
    const segments = garageWallSegments(garage.slot);
    assert.equal(
      floor.geometry.parameters.radiusTop,
      4.05,
      "the platform radius is exactly 1.5 times its original size",
    );
    assert.ok(walls.isInstancedMesh);
    assert.equal(walls.count, segments.length);
    assert.ok(
      segments.length >= 66,
      "the full rim and both bridge guards must be represented",
    );
    for (let index = 0; index < segments.length; index++) {
      walls.getMatrixAt(index, matrix);
      matrix.decompose(position, rotation, scale);
      assert.ok(Math.abs(scale.y - FUEL.wallHeight) < 1e-5);
      assert.ok(Math.abs(scale.z - FUEL.wallThickness) < 1e-5);
      position.applyMatrix4(group.matrixWorld);
      const segment = segments[index];
      assert.ok(
        Math.hypot(
          position.x - (segment.ax + segment.bx) / 2,
          position.z - (segment.az + segment.bz) / 2,
        ) < 1e-5,
        "visible walls follow authoritative contact geometry",
      );
      assert.ok(
        Math.abs(
          scale.x -
            Math.hypot(segment.bx - segment.ax, segment.bz - segment.az) -
            0.01,
        ) < 1e-5,
      );
      const halfSpan = (scale.x - 0.01) / scale.x / 2;
      const renderedA = new THREE.Vector3(-halfSpan, 0, 0)
        .applyMatrix4(matrix)
        .applyMatrix4(group.matrixWorld);
      const renderedB = new THREE.Vector3(halfSpan, 0, 0)
        .applyMatrix4(matrix)
        .applyMatrix4(group.matrixWorld);
      assert.ok(
        Math.hypot(renderedA.x - segment.ax, renderedA.z - segment.az) < 1e-5,
      );
      assert.ok(
        Math.hypot(renderedB.x - segment.bx, renderedB.z - segment.bz) < 1e-5,
        "each visible arc and bridge segment must have the same orientation and endpoints as its collider",
      );
    }
    const gate = group.getObjectByName("garage-door"),
      pump = group.getObjectByName("garage-pump");
    assert.equal(gate.position.z, FUEL.gateOutward);
    assert.equal(
      gate.visible,
      false,
      "open gates leave no beam across the entrance",
    );
    assert.equal(gate.children.length, 3);
    for (const beam of gate.children) {
      assert.equal(beam.scale.x, FUEL.gateHalfWidth * 2);
      assert.equal(beam.position.z, 0);
      assert.ok(beam.material.emissiveIntensity > 1);
    }
    assert.ok(Math.abs(pump.scale.x - 1.92) < 1e-9);
    assert.equal(pump.position.z, FUEL.pumpOutward);
    renderedInstances.push(walls, group.getObjectByName("garage-rim-lights"));
  }
  garages[0].closedUntil = 2000;
  const closingGate = scene
    .getObjectByName("personal-garage-owner-0")
    .getObjectByName("garage-door");
  world.update(1999, new Map(), 1);
  assert.equal(
    closingGate.visible,
    true,
    "all three lasers show during the lock",
  );
  world.update(2000, new Map(), 1);
  assert.equal(
    closingGate.visible,
    false,
    "lasers disappear exactly when the server lock expires",
  );
  let released = 0;
  for (const instance of renderedInstances)
    instance.addEventListener("dispose", () => released++);
  world.setFuel(
    { garages: garages.slice(1), players: [], drops: [] },
    "owner-0",
  );
  assert.equal(
    released,
    2,
    "departing owners immediately release the wall and lighting GPU buffers",
  );
  world.dispose();
  assert.equal(released, FUEL.slots * 2);
  world.dispose();
  assert.equal(released, FUEL.slots * 2);
});
