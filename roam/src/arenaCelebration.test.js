import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createArenaCelebration } from "./arenaCelebration.js";
import { ARENA } from "./arenaConfig.js";

function fixture(t, options) {
  const scene = new THREE.Scene();
  const effect = createArenaCelebration(scene, options);
  const root = scene.getObjectByName("arena-celebration");
  const points = scene.getObjectByName("arena-firework-particles");
  t.after(() => effect.dispose());
  return { scene, root, points, effect };
}
const count = (points) =>
  Array.from(points.geometry.getAttribute("aOpacity").array).filter(
    (value) => value > 0,
  ).length;
const tick = (effect, from, to, step = 1 / 60) => {
  for (let time = from + step; time <= to + 1e-8; time += step)
    effect.update(step, time);
};

test("rockets become bounded colorful bursts, then release the same pooled buffers", (t) => {
  const { root, points, effect } = fixture(t);
  const buffer = points.geometry.getAttribute("position").array;
  assert.equal(root.position.x, ARENA.cx);
  assert.equal(root.position.z, ARENA.cz);
  assert.equal(points.geometry.getAttribute("position").count, 384);
  effect.setRadius(ARENA.maxRadius);
  effect.setNight(1);
  effect.celebrate("start", "round");
  effect.update(0, 0);
  tick(effect, 0, 0.2);
  assert.ok(
    count(points) > 1 && count(points) <= 23,
    "one launch has a head and trail",
  );
  const positions = points.geometry.getAttribute("position").array;
  const opacity = points.geometry.getAttribute("aOpacity").array;
  for (let i = 0; i < opacity.length; i++) {
    if (opacity[i] <= 0) continue;
    assert.ok(
      Math.hypot(positions[i * 3], positions[i * 3 + 2]) > ARENA.maxRadius,
      "rockets launch outside the enlarged playing surface",
    );
    assert.ok(
      points.geometry.boundingSphere.containsPoint(
        new THREE.Vector3().fromArray(positions, i * 3),
      ),
      "expanded launches remain inside their culling bounds",
    );
  }
  tick(effect, 0.2, 1.8);
  assert.ok(
    count(points) > 200 && count(points) <= 384,
    "three bursts share a fixed pool",
  );
  for (const attribute of Object.values(points.geometry.attributes))
    for (const value of attribute.array) assert.ok(Number.isFinite(value));
  assert.equal(points.material.blending, THREE.AdditiveBlending);
  assert.equal(points.material.depthWrite, false);
  assert.equal(
    root.children.length,
    1,
    "no per-particle meshes or point lights",
  );
  tick(effect, 1.8, 4);
  assert.equal(count(points), 0);
  assert.equal(points.visible, false);
  assert.equal(points.geometry.getAttribute("position").array, buffer);
});

test("deduplication distinguishes start from winner without growing geometry", (t) => {
  const { effect, points } = fixture(t);
  assert.equal(effect.celebrate("start", "same"), true);
  assert.equal(effect.celebrate("start", "same"), false);
  assert.equal(effect.celebrate("winner", "same"), true);
  assert.equal(effect.celebrate("winner", "same"), false);
  effect.update(0, 0);
  let lateBursts = false;
  for (let i = 1; i <= 390; i++) {
    effect.update(1 / 60, i / 60);
    assert.ok(count(points) <= 384);
    if (i > 240 && count(points) > 150) lateBursts = true;
  }
  assert.ok(lateBursts, "winner gets a second volley");
  for (let i = 0; i < 100; i++) effect.celebrate("start", `new-${i}`);
  assert.equal(
    effect.celebrate("start", "same"),
    true,
    "old event IDs leave the bounded dedup cache",
  );
  assert.equal(points.geometry.getAttribute("position").count, 384);
});

test("spark trajectories agree at 30 and 60 fps", (t) => {
  const first = fixture(t),
    second = fixture(t);
  for (const { effect } of [first, second]) {
    effect.celebrate("start", "one");
    effect.update(0, 0);
  }
  tick(first.effect, 0, 1.5, 1 / 60);
  tick(second.effect, 0, 1.5, 1 / 30);
  const a = first.points.geometry.attributes,
    b = second.points.geometry.attributes;
  for (let i = 0; i < 384; i++) {
    assert.ok(Math.abs(a.aOpacity.array[i] - b.aOpacity.array[i]) < 1e-5);
    if (a.aOpacity.array[i] > 0)
      for (let axis = 0; axis < 3; axis++)
        assert.ok(
          Math.abs(
            a.position.array[i * 3 + axis] - b.position.array[i * 3 + axis],
          ) < 1e-5,
        );
  }
});

test("idle launches stay sparse and stale tab resumes discard queued effects", (t) => {
  const { effect, points } = fixture(t);
  effect.update(0, 0);
  tick(effect, 0, 7);
  assert.equal(count(points), 0);
  let launched = false;
  for (let i = 421; i <= 720; i++) {
    effect.update(1 / 60, i / 60);
    launched ||= count(points) > 0;
  }
  assert.ok(launched, "first idle firework launches within 8–12 seconds");
  effect.celebrate("winner", "before-suspend");
  effect.update(60, 72);
  assert.equal(count(points), 0);
  tick(effect, 72, 78);
  assert.equal(count(points), 0, "no catch-up barrage after resuming");
});

test("reduced motion disables launches and disposing releases resources exactly once", (t) => {
  const { scene, effect, points } = fixture(t, { reducedMotion: true });
  let geometryDisposals = 0,
    materialDisposals = 0;
  points.geometry.addEventListener("dispose", () => geometryDisposals++);
  points.material.addEventListener("dispose", () => materialDisposals++);
  assert.equal(effect.celebrate("winner", "round"), false);
  effect.update(0, 0);
  tick(effect, 0, 15);
  assert.equal(count(points), 0);
  assert.equal(points.visible, false);
  effect.dispose();
  effect.dispose();
  assert.equal(geometryDisposals, 1);
  assert.equal(materialDisposals, 1);
  assert.equal(scene.getObjectByName("arena-celebration"), undefined);
  assert.equal(effect.celebrate("start", "after-dispose"), false);
});
