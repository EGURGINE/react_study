import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createDuelWorld } from "./duelWorld.js";
import { DUEL_OBSTACLE_RULES } from "./duelObstacles.js";

const raceFixture = (status = "racing", id = "race-1") => ({
  id,
  status,
  hostId: "host",
  guestId: "guest",
  obstacles: [0, 1].flatMap((lane) =>
    ["jump", "bounce"].map((kind, index) => ({
      id: `${id}-${lane}-${kind}`,
      kind,
      lane,
      x: lane === 0 ? -32.75 : -29.25,
      z: index === 0 ? 8 : -6,
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
  const opponent = race.obstacles[2];
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
