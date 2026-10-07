import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createRailWorld } from "./railWorld.js";

function fixture(t, options) {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ fillRect() {}, fillText() {} }),
    }),
  };
  const scene = new THREE.Scene();
  let world;
  try {
    world = createRailWorld(scene, options);
  } finally {
    globalThis.document = previousDocument;
  }
  const geometries = new Set();
  const materials = new Set();
  scene.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.material) materials.add(object.material);
  });
  t.after(() => {
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) {
      material.map?.dispose();
      material.dispose();
    }
  });
  const coins = [0, 1].map((index) =>
    scene.getObjectByName(`rail-reward-coin-${index}`),
  );
  return { scene, world, coins, geometries, materials };
}

const pose = (coin) => [
  ...coin.position.toArray(),
  ...coin.rotation.toArray().slice(0, 3),
  ...coin.scale.toArray(),
];

test("large gold reward coins float and turn together without relying on frame rate", (t) => {
  const { world, coins } = fixture(t);
  assert.deepEqual(
    coins.map((coin) => [coin.position.x, coin.position.z]),
    [
      [-9.6, 34],
      [9.6, 34],
    ],
  );
  for (const coin of coins) {
    assert.equal(coin.scale.x, 2.3);
    assert.equal(
      coin.children[0].geometry.parameters.radiusTop * coin.scale.x,
      1.15,
    );
  }
  const body = coins[0].children[0];
  assert.equal(body.material, coins[1].children[0].material);
  const dayIntensity = body.material.emissiveIntensity;
  assert.ok(dayIntensity >= 1 && dayIntensity < 1.5);
  world.setNight(1);
  assert.ok(
    body.material.emissiveIntensity > 2.5 &&
      body.material.emissiveIntensity <= 3,
  );
  const original = pose(coins[0]);
  world.update(1 / 60, 2);
  assert.notDeepEqual(pose(coins[0]), original);
  assert.equal(coins[0].position.y, coins[1].position.y);
  assert.equal(coins[0].rotation.y, coins[1].rotation.y);
  assert.ok(coins[0].position.y >= 1.48 && coins[0].position.y <= 2.02);
  const atTwoSeconds = pose(coins[0]);
  world.update(0.2, 2);
  assert.deepEqual(pose(coins[0]), atTwoSeconds);
  world.setNight(0);
  assert.equal(body.material.emissiveIntensity, dayIntensity);
  world.update(1 / 60, Number.MAX_VALUE);
  assert.ok(coins.flatMap(pose).every(Number.isFinite));
});

test("a paid-lap pulse lasts one second and reuses all scene resources", (t) => {
  const { world, scene, coins, geometries, materials } = fixture(t);
  const bodyMaterial = coins[0].children[0].material;
  const baselineIntensity = bodyMaterial.emissiveIntensity;
  const objects = [];
  scene.traverse((object) => objects.push(object));
  const attributes = [...geometries]
    .flatMap((geometry) => Object.values(geometry.attributes))
    .map((attribute) => ({
      attribute,
      array: attribute.array,
      version: attribute.version,
    }));
  world.update(0.016, 10);
  world.reward(10);
  world.update(0.016, 10.5);
  assert.ok(coins[0].scale.x > 2.5);
  assert.equal(coins[0].scale.x, coins[1].scale.x);
  assert.ok(bodyMaterial.emissiveIntensity > baselineIntensity);
  world.update(0.016, 11.01);
  assert.equal(coins[0].scale.x, 2.3);
  assert.equal(bodyMaterial.emissiveIntensity, baselineIntensity);
  for (let frame = 0; frame < 1000; frame++) {
    const elapsed = 12 + frame / 60;
    world.setNight((frame % 60) / 60);
    if (frame % 120 === 0) world.reward(elapsed);
    world.update(1 / 60, elapsed);
  }
  const after = [];
  scene.traverse((object) => after.push(object));
  assert.deepEqual(after, objects);
  assert.deepEqual(
    new Set(
      after
        .filter((object) => object.geometry)
        .map((object) => object.geometry),
    ),
    geometries,
  );
  assert.deepEqual(
    new Set(
      after
        .filter((object) => object.material)
        .map((object) => object.material),
    ),
    materials,
  );
  for (const { attribute, array, version } of attributes) {
    assert.equal(attribute.array, array);
    assert.equal(attribute.version, version);
  }
});

test("reduced motion fixes coin poses while keeping gentle reward feedback and finite state", (t) => {
  const { world, coins } = fixture(t, { reducedMotion: true });
  const initial = coins.map(pose);
  const material = coins[0].children[0].material;
  const normalIntensity = material.emissiveIntensity;
  world.update(1 / 60, 30);
  world.reward(30);
  world.update(1 / 60, 30.5);
  assert.deepEqual(coins.map(pose), initial);
  assert.ok(material.emissiveIntensity > normalIntensity);
  world.update(1 / 60, 31.1);
  assert.equal(material.emissiveIntensity, normalIntensity);
  for (const invalid of [NaN, Infinity, -Infinity, -1]) {
    world.reward(invalid);
    world.setNight(invalid);
    world.update(invalid, invalid);
    assert.deepEqual(coins.map(pose), initial);
    assert.ok(Number.isFinite(material.emissiveIntensity));
  }
});
