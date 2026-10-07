import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createNightLights } from "./nightLights.js";
import { installCarBodies, applyCarCosmetics } from "./cosmeticsWorld.js";
import { BODY_STYLES, ITEMS } from "./cosmeticsCatalog.js";

function fixture(t) {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, "canvas");
      return { getContext: () => ({ clearRect() {}, fillText() {} }) };
    },
  };
  const scene = new THREE.Scene();
  const car = new THREE.Group();
  const visual = new THREE.Group();
  visual.name = "car-visual";
  const body = new THREE.Group();
  body.name = "car-body";
  scene.add(car);
  car.add(visual);
  visual.add(body);
  // The jeep is assembled inside world.js. Keep its existing lamp housings in
  // this fixture; installCarBodies builds the other six production shells.
  for (const x of [-0.42, 0.42]) {
    for (const [w, h, z, y] of [
      [0.2, 0.15, 0.978, 0.6],
      [0.18, 0.12, -0.978, 0.56],
    ]) {
      const housing = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, 0.05),
        new THREE.MeshStandardMaterial(),
      );
      housing.position.set(x, y, z);
      body.add(housing);
    }
  }
  installCarBodies(body);
  const lights = createNightLights(scene, car);
  const emitters = car.getObjectByName("vehicle-night-emitters").children;
  t.after(() => {
    lights.dispose();
    const resources = new Set();
    scene.traverse((object) => {
      if (object.geometry) resources.add(object.geometry);
      for (const material of [object.material].flat().filter(Boolean)) {
        resources.add(material);
        for (const value of Object.values(material))
          if (value?.isTexture) resources.add(value);
      }
    });
    for (const resource of resources) resource.dispose();
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });
  return { scene, car, visual, body, lights, emitters };
}

test("vehicle emitters keep their body-relative pose through suspension, tilt, jumping, and steering", (t) => {
  const { scene, car, visual, body, lights, emitters } = fixture(t);
  assert.equal(emitters.length, 4);
  scene.updateMatrixWorld(true);
  const bodyInverse = body.matrixWorld.clone().invert();
  const relative = emitters.map((lamp) =>
    bodyInverse.clone().multiply(lamp.matrixWorld),
  );
  for (const elapsed of [0.1, 0.7, 1.5, 4.2]) {
    car.position.set(elapsed * 4, 0, 7 - elapsed * 3);
    car.rotation.y = elapsed * 1.2;
    visual.position.y = Math.max(0, Math.sin(elapsed)) * 2;
    body.position.y = Math.sin(elapsed * 12) * 0.06;
    body.rotation.set(Math.sin(elapsed) * 0.08, 0, Math.cos(elapsed) * 0.1);
    lights.update(1, elapsed);
    scene.updateMatrixWorld(true);
    for (const [index, lamp] of emitters.entries()) {
      const expected = body.matrixWorld.clone().multiply(relative[index]);
      for (let entry = 0; entry < 16; entry++)
        assert.ok(
          Math.abs(
            expected.elements[entry] - lamp.matrixWorld.elements[entry],
          ) < 1e-10,
          `Lamp ${index} separated from its moving body at ${elapsed}s`,
        );
    }
  }
});

test("front and rear emitters remain clear of the existing lamps and all seven selected shells", (t) => {
  const { scene, car, emitters } = fixture(t);
  for (const style of BODY_STYLES) {
    const item = ITEMS.find(
      (item) => item.type === "body" && item.style === style,
    );
    applyCarCosmetics(car, { body: item.id });
    scene.updateMatrixWorld(true);
    const shell = car.getObjectByName(`body-${style}`);
    assert.equal(shell.visible, true);
    for (const lamp of emitters) {
      const lampBounds = new THREE.Box3().setFromObject(lamp);
      let checked = 0;
      shell.traverse((part) => {
        if (!part.isMesh) return;
        checked++;
        assert.ok(
          !lampBounds.intersectsBox(new THREE.Box3().setFromObject(part)),
          `${style} ${lamp.position.z > 0 ? "headlight" : "rear lamp"} intersects its housing or shell`,
        );
      });
      assert.ok(checked >= 4, `${style} needs real housing geometry`);
    }
  }
});

test("fixed-night lamps stay steady, peer clones share the glow without lights, and disposal removes illumination", (t) => {
  const { scene, car, lights, emitters } = fixture(t);
  const peer = car.clone(true);
  scene.add(peer);
  const peerEmitters = peer.getObjectByName("vehicle-night-emitters").children;
  let peerLights = 0;
  peer.traverse((object) => {
    if (object.isLight) peerLights++;
  });
  assert.equal(
    peerLights,
    0,
    "Each remote clone must not create another real light",
  );
  for (const [index, lamp] of emitters.entries()) {
    assert.equal(peerEmitters[index].geometry, lamp.geometry);
    assert.equal(peerEmitters[index].material, lamp.material);
  }
  lights.update(0.8, 0);
  const brightness = emitters.map((lamp) => lamp.material.emissiveIntensity);
  assert.ok(brightness.every((value) => value > 1.2));
  const realLights = [];
  scene.traverse((object) => {
    if (object.isLight) realLights.push(object);
  });
  assert.equal(realLights.filter((light) => light.isSpotLight).length, 1);
  const target = scene.getObjectByName("local-car-headlight-target");
  for (const elapsed of [0.03, 0.4, 1.8, 19.2, 250]) {
    lights.update(0.8, elapsed);
    assert.deepEqual(
      emitters.map((lamp) => lamp.material.emissiveIntensity),
      brightness,
    );
    assert.deepEqual(
      peerEmitters.map((lamp) => lamp.material.emissiveIntensity),
      brightness,
    );
  }
  lights.dispose();
  lights.dispose();
  lights.update(1, 999);
  for (const light of realLights) {
    assert.equal(light.parent, null);
    assert.equal(light.intensity, 0);
  }
  assert.equal(target.parent, null);
  // The owner still needs to see the shared meshes during GPU disposal.
  assert.equal(
    car.getObjectByName("vehicle-night-emitters").children.length,
    4,
  );
});
