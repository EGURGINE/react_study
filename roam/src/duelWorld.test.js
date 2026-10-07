import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createDuelWorld } from "./duelWorld.js";
import { DUEL_OBSTACLE_RULES } from "./duelObstacles.js";
import { DUEL_TRACK, duelPoint, projectDuel } from "./gameConfig.js";

const raceFixture = (status = "racing", id = "race-1") => ({
  id,
  status,
  hostId: "host",
  guestId: "guest",
  obstacles: [0, 1].flatMap((lane) =>
    ["jump", "bounce", "boost"].map((kind, index) => ({
      id: `${id}-${lane}-${kind}`,
      kind,
      lane,
      ...duelPoint([0.12, 0.35, 0.6][index], lane === 0 ? -1.75 : 1.75),
      r: DUEL_OBSTACLE_RULES[kind].r,
    })),
  ),
});

function fixture(t) {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ fillRect() {}, fillText() {} }),
    }),
  };
  const scene = new THREE.Scene();
  const world = createDuelWorld(scene);
  globalThis.document = previousDocument;
  t.after(() => {
    world.setRace(null, null);
    const geometries = new Set();
    const materials = new Set();
    scene.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) materials.add(object.material);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) {
      material.map?.dispose();
      material.dispose();
    }
  });
  return { scene, world, root: scene.getObjectByName("duel-race-obstacles") };
}

test("matched players see the same layout before launch but countdown cannot trigger", (t) => {
  const { world, root } = fixture(t);
  const race = raceFixture("countdown");
  world.setRace(race, "host");
  assert.deepEqual(
    root.children.map((child) => child.name),
    race.obstacles.map((item) => item.id),
  );
  assert.equal(world.hit({ ...race.obstacles[0], y: 0 }, 8, 10), null);
  assert.equal(world.play(race.obstacles[0].id, 10), false);
  const hostPositions = root.children.map((child) => child.position.toArray());
  world.setRace(race, "guest");
  assert.deepEqual(
    root.children.map((child) => child.position.toArray()),
    hostPositions,
  );
  world.setRace({ ...race, status: "racing" }, "host");
  assert.equal(
    world.hit({ ...race.obstacles[0], y: 0 }, 8, 10)?.id,
    race.obstacles[0].id,
  );
});

test("jumping over obstacles avoids them while changing lanes keeps collisions active", (t) => {
  const { world } = fixture(t);
  const race = raceFixture();
  world.setRace(race, "host");
  const local = race.obstacles[0];
  const opponent = race.obstacles.find((item) => item.lane === 1);
  assert.equal(
    world.hit(
      { ...local, y: DUEL_OBSTACLE_RULES.jump.maxTriggerHeight + 0.01 },
      8,
      10,
    ),
    null,
  );
  assert.equal(world.hit({ ...opponent, y: 0 }, 8, 10)?.id, opponent.id);
  world.play(opponent.id, 10);
  assert.equal(world.hit({ ...opponent, y: 0 }, 8, 10.1), null);
  assert.equal(
    world.hit({ ...local, x: local.x + local.r + 0.46, y: 0 }, 8, 10),
    null,
  );
  assert.equal(world.hit({ ...local, y: 0 }, 8, 10)?.id, local.id);
});

test("remote obstacle animation neither consumes nor extends local cooldown", (t) => {
  const { world, scene } = fixture(t);
  const race = raceFixture();
  const obstacle = race.obstacles[1];
  world.setRace(race, "host");
  assert.equal(world.play(obstacle.id, 10, true, race.id), true);
  assert.equal(world.hit({ ...obstacle, y: 0 }, 8, 10)?.id, obstacle.id);
  assert.equal(world.play(obstacle.id, 10), true);
  assert.equal(world.hit({ ...obstacle, y: 0 }, 8, 10.1), null);
  assert.equal(world.play(obstacle.id, 10.6, true, race.id), true);
  world.setNight(1);
  world.update(0.016, 10.65);
  const flash = scene
    .getObjectByName(obstacle.id)
    .children.find((child) => child.material?.transparent);
  assert.ok(flash.visible && flash.material.opacity > 0);
  assert.equal(
    world.hit(
      { ...obstacle, y: 0 },
      8,
      10 + DUEL_OBSTACLE_RULES.bounce.cooldownMs / 1000 + 0.01,
    )?.id,
    obstacle.id,
  );
  assert.equal(world.play(obstacle.id, 12, true, "old-race"), false);
});

test("race resolution removes obstacles and disposes their private resources", (t) => {
  const { world, root } = fixture(t);
  const first = raceFixture();
  world.setRace(first, "host");
  let disposed = 0;
  root.children[0].children[1].geometry.addEventListener(
    "dispose",
    () => disposed++,
  );
  world.setRace(null, "host");
  assert.equal(root.children.length, 0);
  assert.equal(disposed, 1);
  assert.equal(world.play(first.obstacles[0].id, 10, true, first.id), false);
  const next = raceFixture("racing", "race-2");
  world.setRace(next, "host");
  assert.deepEqual(
    root.children.map((child) => child.name),
    next.obstacles.map((item) => item.id),
  );
  world.setRace(next, "spectator");
  assert.equal(root.children.length, 0);
});

test("boost strips stay flat, show directional chevrons, and use independent cooldowns", (t) => {
  const { world, scene } = fixture(t);
  const race = raceFixture();
  const pad = race.obstacles.find((item) => item.kind === "boost");
  world.setRace(race, "host");
  const object = scene.getObjectByName(pad.id);
  const arrows = [];
  object.traverse((child) => {
    if (child.name === "duel-boost-chevron") arrows.push(child);
  });
  assert.equal(arrows.length, 6);
  object.updateWorldMatrix(true, true);
  const before = new THREE.Box3().setFromObject(object);
  assert.ok(
    before.max.y < 0.25,
    "acceleration strips have no raised spring or bumper",
  );
  assert.equal(world.play(pad.id, 10, true, race.id), true);
  assert.equal(world.hit({ ...pad, y: 0 }, 6, 10)?.id, pad.id);
  assert.equal(world.play(pad.id, 10), true);
  assert.equal(world.hit({ ...pad, y: 0 }, 6, 10.5), null);
  world.setNight(1);
  world.update(0.016, 10.2);
  object.updateWorldMatrix(true, true);
  assert.ok(new THREE.Box3().setFromObject(object).max.y < 0.25);
  assert.equal(world.hit({ ...pad, y: 0 }, 6, 11.71)?.id, pad.id);
});

test("closed circuit surface follows the shared road bounds and has no seam", (t) => {
  const { scene } = fixture(t);
  const road = scene.getObjectByName("duel-road-surface");
  const positions = road.geometry.getAttribute("position");
  const normals = road.geometry.getAttribute("normal");
  const segments = positions.count / 2 - 1;
  for (let index = 0; index <= segments; index++) {
    for (const [side, offset] of [
      -DUEL_TRACK.halfWidth,
      DUEL_TRACK.halfWidth,
    ].entries()) {
      const expected = duelPoint(index / segments, offset);
      const vertex = index * 2 + side;
      assert.ok(Math.abs(positions.getX(vertex) - expected.x) < 0.00001);
      assert.ok(Math.abs(positions.getZ(vertex) - expected.z) < 0.00001);
      assert.ok(normals.getY(vertex) > 0.99, "road faces upward");
    }
  }
  for (let side = 0; side < 2; side++) {
    assert.equal(positions.getX(side), positions.getX(segments * 2 + side));
    assert.equal(positions.getZ(side), positions.getZ(segments * 2 + side));
  }
  road.geometry.computeBoundingBox();
  assert.ok(road.geometry.boundingBox.min.z < -22);
  assert.ok(road.geometry.boundingBox.max.z > 43);
});

test("one start-finish gate leaves the full road clear and long markings are instanced", (t) => {
  const { scene } = fixture(t);
  scene.updateMatrixWorld(true);
  const gates = [],
    instanced = [];
  let meshCount = 0;
  scene.traverse((object) => {
    if (object.name === "duel-start-finish-gate") gates.push(object);
    if (object.isInstancedMesh) instanced.push(object);
    if (object.isMesh) meshCount++;
  });
  assert.equal(gates.length, 1);
  for (const side of [-1, 1]) {
    const pole = scene.getObjectByName(`duel-gate-pole-${side}`);
    const point = pole.getWorldPosition(new THREE.Vector3());
    assert.ok(
      projectDuel(point.x, point.z).distance > DUEL_TRACK.halfWidth + 0.3,
    );
  }
  assert.ok(instanced.reduce((sum, object) => sum + object.count, 0) > 250);
  assert.ok(
    meshCount < 90,
    "long course should not create hundreds of static draw calls",
  );
});
