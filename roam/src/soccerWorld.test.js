import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { SOCCER, soccerBall } from "./soccerConfig.js";
import {
  createSoccerWorld,
  soccerViewSize,
  soccerPoseTransfer,
} from "./soccerWorld.js";
import { DUEL_TRACK, duelPoint } from "./gameConfig.js";

function fixture(t, options) {
  const scene = new THREE.Scene();
  const world = createSoccerWorld(scene, options);
  t.after(() => world.dispose());
  return { scene, world, ball: scene.getObjectByName("soccer-ball") };
}
const match = (dx = 0, sequence = 0, status = "playing") => ({
  id: "round",
  sequence,
  status,
  ball: { ...soccerBall(), x: SOCCER.cx + dx, vx: 10 },
});

test("pitch, open goal mouths and curved football markings fit the authoritative field", (t) => {
  const { scene, ball } = fixture(t);
  const root = scene.getObjectByName("soccer-field");
  assert.equal(root.position.x, SOCCER.cx);
  assert.equal(root.position.z, SOCCER.cz);
  const surface = scene.getObjectByName("soccer-playing-surface");
  assert.equal(surface.geometry.parameters.width, SOCCER.halfLength * 2);
  assert.equal(surface.geometry.parameters.depth, SOCCER.halfWidth * 2);
  for (const [team, sign] of [
    ["blue", -1],
    ["orange", 1],
  ]) {
    const goal = scene.getObjectByName(`soccer-${team}-goal`);
    assert.equal(
      goal.position.x,
      sign * (SOCCER.halfLength + SOCCER.goalDepth / 2),
    );
  }
  assert.ok(
    scene.getObjectByName("soccer-goal-nets").geometry.attributes.position
      .count > 100,
  );
  const patches = ball.children[1].geometry.attributes.position;
  // Triangle centers must remain above the sphere, not sink under its surface.
  const center = new THREE.Vector3();
  for (let i = 0; i < patches.count; i += 3) {
    center.set(0, 0, 0);
    for (let j = 0; j < 3; j++)
      center.add(new THREE.Vector3().fromBufferAttribute(patches, i + j));
    assert.ok(center.multiplyScalar(1 / 3).length() > SOCCER.ballRadius);
  }
  for (let i = 0; i < 512; i++) {
    const point = duelPoint(i / 512);
    const dx = Math.max(
      0,
      Math.abs(point.x - SOCCER.cx) - SOCCER.halfLength - SOCCER.goalDepth,
    );
    const dz = Math.max(
      0,
      Math.abs(point.z - SOCCER.cz) - SOCCER.halfWidth - 0.7,
    );
    assert.ok(Math.hypot(dx, dz) > DUEL_TRACK.halfWidth + 0.35);
  }
});

test("server snapshots interpolate smoothly, extrapolate briefly, and stop without new packets", (t) => {
  const { world, ball } = fixture(t);
  world.setMatch(match());
  world.update(0.1, 0.1);
  world.setMatch(match(1));
  world.update(0.05, 0.15);
  assert.ok(Math.abs(ball.position.x - 0.75) < 1e-8);
  world.update(0.15, 0.3);
  assert.ok(Math.abs(ball.position.x - 2) < 1e-8);
  world.update(10, 10.3);
  assert.ok(
    Math.abs(ball.position.x - 2) < 1e-8,
    "a stale packet cannot keep the ball drifting",
  );
  world.setMatch({ ...match(), ball: { ...soccerBall(), x: NaN } });
  world.update(0.1, NaN);
  assert.ok(ball.position.toArray().every(Number.isFinite));
});

test("goals, kickoff sequence changes and leaving snap instead of interpolating across the field", (t) => {
  const { world, ball } = fixture(t, { reducedMotion: true });
  world.setMatch(match(18));
  world.update(0.1, 0.1);
  world.setMatch(match(21, 0, "goal"));
  assert.equal(ball.position.x, 21);
  world.update(1, 1.1);
  assert.equal(ball.position.x, 21);
  world.setMatch(match(0, 1));
  assert.equal(ball.position.x, 0);
  world.update(0.05, 1.15);
  assert.ok(
    ball.quaternion.equals(new THREE.Quaternion()),
    "reduced motion preserves ball tracking but skips decorative rolling",
  );
  world.setMatch(null);
  assert.equal(ball.position.x, 0);
  assert.equal(ball.position.y, SOCCER.ballRadius);
});

test("updates reuse geometry and disposal releases each privately owned resource once", (t) => {
  const { world, scene } = fixture(t);
  const root = scene.getObjectByName("soccer-field");
  const resources = new Set();
  let objects = 0;
  root.traverse((object) => {
    objects++;
    if (object.geometry) resources.add(object.geometry);
    if (object.material) resources.add(object.material);
  });
  const counts = new Map();
  for (const resource of resources)
    resource.addEventListener("dispose", () =>
      counts.set(resource, (counts.get(resource) || 0) + 1),
    );
  for (let i = 0; i < 1000; i++) {
    world.setMatch(match(Math.sin(i / 100)));
    world.update(1 / 60, i / 60);
    world.setNight((i % 100) / 100);
  }
  let after = 0;
  root.traverse((object) => {
    after++;
    if (object.geometry) assert.ok(resources.has(object.geometry));
    if (object.material) assert.ok(resources.has(object.material));
  });
  assert.equal(after, objects);
  world.dispose();
  world.dispose();
  assert.equal(scene.getObjectByName("soccer-field"), undefined);
  for (const resource of resources) assert.equal(counts.get(resource), 1);
});

test("teleports take priority while their matching soccer-state packet is still in flight", () => {
  const room = { ...match(), players: [{ id: "me", team: "blue" }] };
  const island = { x: 1.3, z: 7.8 };
  const pitch = { x: SOCCER.cx - 8, z: SOCCER.cz };
  assert.equal(soccerPoseTransfer(room, "me", island), "leaving");
  assert.equal(soccerPoseTransfer(room, "me", island, "leaving"), "leaving");
  assert.equal(soccerPoseTransfer(room, "me", pitch, "leaving"), null);
  assert.equal(
    soccerPoseTransfer({ ...room, status: "waiting" }, "me", pitch),
    "entering",
  );
  assert.equal(
    soccerPoseTransfer({ ...room, status: "waiting" }, "me", island),
    null,
  );
  assert.equal(soccerPoseTransfer(null, "me", island, "leaving"), null);
  assert.equal(soccerPoseTransfer(room, "spectator", pitch), null);
});

test("the full pitch and both goals remain visible inside the actual mobile and desktop content width", (t) => {
  const { scene } = fixture(t);
  scene.updateMatrixWorld(true);
  for (const [contentWidth, height, canvasScale, left] of [
    [1280, 676.8, 1.06, 12.8],
    [390, 683.64, 1.36, -66.3],
  ]) {
    const width = contentWidth * canvasScale;
    const size = soccerViewSize(width, height, contentWidth);
    const camera = new THREE.OrthographicCamera(
      (-size * width) / height / 2,
      (size * width) / height / 2,
      size / 2,
      -size / 2,
      0.1,
      300,
    );
    const target = new THREE.Vector3(SOCCER.cx, 0, SOCCER.cz);
    camera.position.copy(target).add(new THREE.Vector3(24, 29, 32));
    camera.lookAt(target);
    camera.updateMatrixWorld();
    const point = new THREE.Vector3();
    for (const name of [
      "soccer-playing-surface",
      "soccer-blue-goal",
      "soccer-orange-goal",
      "soccer-goal-nets",
    ]) {
      const object = scene.getObjectByName(name);
      const positions = object.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        point
          .fromBufferAttribute(positions, i)
          .applyMatrix4(object.matrixWorld)
          .project(camera);
        const x = left + ((point.x + 1) * width) / 2;
        assert.ok(
          x > 0 && x < contentWidth,
          `${name} clips at ${contentWidth}px`,
        );
        assert.ok(Math.abs(point.y) < 1, `${name} clips vertically`);
      }
    }
  }
});
