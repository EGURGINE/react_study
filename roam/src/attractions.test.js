import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { ATTRACTIONS, createAttractions } from "./attractions.js";

function fixture(t) {
  const scene = new THREE.Scene();
  const attractions = createAttractions(scene);
  t.after(() => {
    const geometries = new Set();
    const materials = new Set();
    scene.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) materials.add(object.material);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
  });
  return { scene, attractions };
}

for (const [id, cooldown] of [
  ["boost-1", 1.5],
  ["jump-1", 1.8],
  ["bumper-1", 1.2],
]) {
  test(`remote ${id} effects preserve the local driver's cooldown`, (t) => {
    const { scene, attractions } = fixture(t);
    const object = ATTRACTIONS.find((attraction) => attraction.id === id);

    assert.equal(attractions.play(id, 10, true), true);
    attractions.update(0.016, 10.016);
    const flash = scene
      .getObjectByName(id)
      .children.find((child) => child.material?.transparent);
    assert.ok(
      flash.visible && flash.material.opacity > 0,
      "remote hit must still display its visual effect",
    );
    assert.equal(
      attractions.hit(object, -3, 10.02)?.id,
      id,
      "remote hit must not consume a fresh local trigger",
    );

    assert.equal(attractions.play(id, 10.02), true);
    assert.equal(
      attractions.hit(object, -3, 10.03),
      null,
      "local activation must still consume its own cooldown",
    );
    assert.equal(
      attractions.play(id, 10.52, true),
      true,
      "peers can display effects during the local cooldown",
    );
    assert.equal(
      attractions.hit(object, -3, 10.53),
      null,
      "remote effect must not clear the local cooldown",
    );
    assert.equal(
      attractions.hit(object, -3, 10.02 + cooldown + 0.001)?.id,
      id,
      "remote effect must not extend the local cooldown",
    );
  });
}

test("remote crate bursts consume the shared eight-second respawn cooldown", (t) => {
  const { attractions } = fixture(t);
  const crate = ATTRACTIONS.find((attraction) => attraction.id === "pop-1");
  assert.equal(attractions.play(crate.id, 10, true), true);
  assert.equal(attractions.hit(crate, -3, 10.01), null);
  assert.equal(attractions.play(crate.id, 12), false);
  assert.equal(attractions.play(crate.id, 15, true), false);
  assert.equal(attractions.hit(crate, -3, 17.999), null);
  assert.equal(attractions.hit(crate, -3, 18)?.id, crate.id);
  assert.equal(attractions.play(crate.id, 18), true);
});
