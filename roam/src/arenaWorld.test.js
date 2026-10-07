import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createArenaWorld } from "./arenaWorld.js";
import { ARENA, createArenaLayout } from "./arenaConfig.js";

function setup(t) {
  const scene = new THREE.Scene();
  // Arena architecture never requires WebGL or a DOM canvas to construct.
  const world = createArenaWorld(scene);
  t.after(() => world.dispose());
  return { scene, world };
}
const match = (count = 4, id = "round-1") => ({
  id,
  status: "running",
  players: [
    { id: "local", alive: true },
    { id: "peer", alive: true },
  ],
  ...createArenaLayout(count, () => 0.4),
});

test("server layout controls pad positions, radius, and guard gaps for everyone", (t) => {
  const { scene, world } = setup(t);
  const round = match(10);
  world.setMatch(round, "local");
  scene.updateMatrixWorld(true);
  assert.equal(
    scene.getObjectByName("arena-playing-surface").geometry.parameters
      .radiusTop,
    round.radius,
  );
  for (const pad of round.obstacles) {
    const position = scene
      .getObjectByName(pad.id)
      .getWorldPosition(new THREE.Vector3());
    assert.ok(
      Math.abs(position.x - pad.x) < 1e-8 &&
        Math.abs(position.z - pad.z) < 1e-8,
    );
    assert.equal(world.hit({ ...pad, y: 0 }, -4, 10)?.id, pad.id);
    assert.equal(world.hit({ ...pad, y: 3 }, 4, 10), null);
  }
  const posts = [];
  scene.traverse((object) => {
    if (object.name.endsWith("-post")) posts.push(object);
  });
  assert.equal(posts.length, round.guards.length * 3);
  for (const post of posts)
    assert.ok(
      Math.abs(Math.hypot(post.position.x, post.position.z) - round.radius) <
        1e-8,
    );
  world.setMatch(round, "spectator");
  assert.equal(world.hit({ ...round.obstacles[0], y: 0 }, 4, 12), null);
  assert.ok(
    scene.getObjectByName(round.obstacles[0].id),
    "spectators see the same obstacles",
  );
});

test("remote pad effects leave local cooldown available and ignore old matches", (t) => {
  const { world } = setup(t);
  const round = match();
  world.setMatch(round, "local");
  for (const pad of round.obstacles) {
    assert.equal(world.play(pad.id, 10, true, round.id), true);
    assert.equal(world.hit({ ...pad, y: 0 }, 4, 10)?.id, pad.id);
    assert.equal(world.play(pad.id, 10), true);
    assert.equal(world.hit({ ...pad, y: 0 }, 4, 10.1), null);
    assert.equal(world.play(pad.id, 11, true, "old-match"), false);
  }
  world.setMatch(
    { ...round, players: [{ id: "local", alive: false }] },
    "local",
  );
  assert.equal(world.hit({ ...round.obstacles[0], y: 0 }, 4, 20), null);
});

test("layout replacement and idempotent disposal release private geometry once", (t) => {
  const { scene, world } = setup(t);
  const old = scene.getObjectByName("arena-playing-surface").geometry;
  let releases = 0;
  old.addEventListener("dispose", () => releases++);
  world.setMatch(match(8), "local");
  assert.equal(releases, 1);
  const root = scene.getObjectByName("colosseum-arena");
  assert.equal(root.position.x, ARENA.cx);
  const watched = scene.getObjectByName("arena-playing-surface").geometry;
  let nextReleases = 0;
  watched.addEventListener("dispose", () => nextReleases++);
  world.setNight(1);
  world.update(0.016, 10);
  root.traverse((object) => {
    if (object.material)
      assert.ok(Number.isFinite(object.material.emissiveIntensity));
  });
  world.dispose();
  world.dispose();
  assert.equal(nextReleases, 1);
  assert.equal(scene.getObjectByName("colosseum-arena"), undefined);
});
