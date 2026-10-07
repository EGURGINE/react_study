import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  ITEMS,
  BODY_STYLES,
  TRAIL_STYLES,
  SPRAY_STYLES,
} from "./cosmeticsCatalog.js";
import {
  ITEMS as configuredItems,
  ITEM_BY_ID,
  STARTER_EQUIPPED,
} from "./gameConfig.js";
import {
  installCarBodies,
  applyCarCosmetics,
  createCosmeticsEffects,
  createSprayCanvas,
} from "./cosmeticsWorld.js";

const original = [
  ["body-starter", "common", "처음의 지프", "#efaa8c", "jeep"],
  ["trail-none", "common", "가볍게 달리기", "#ffffff", "none"],
  ["spray-wave", "common", "반가워!", "#80a781", "wave"],
  ["body-cream", "common", "바닐라 지프", "#eee1b6", "jeep"],
  ["body-mint", "common", "민트 버기", "#a2c9b0", "buggy"],
  ["body-peach", "common", "피치 밴", "#e8a18a", "van"],
  ["trail-dust", "common", "뽀얀 먼지", "#e0d8bd", "dust"],
  ["spray-smile", "common", "싱긋", "#e4b564", "smile"],
  ["spray-flower", "common", "작은 꽃", "#eba99b", "flower"],
  ["body-ocean", "rare", "오션 스포츠", "#5f9bcc", "sport"],
  ["body-sky", "rare", "소다 밴", "#7ebbd0", "van"],
  ["trail-bubbles", "rare", "소다 버블", "#89c9e8", "bubbles"],
  ["spray-heart", "rare", "마음을 남겨요", "#ef94b8", "heart"],
  ["body-lavender", "epic", "라벤더 레이서", "#b095d8", "sport"],
  ["trail-stars", "epic", "별빛 산책", "#c1a1ef", "stars"],
  ["spray-lightning", "epic", "찌릿!", "#ab82df", "lightning"],
  ["body-gold", "legendary", "골든 아워", "#eac45d", "sport"],
  ["trail-rainbow", "legendary", "무지개 꼬리", "#f4cf68", "rainbow"],
  ["spray-crown", "legendary", "오늘의 왕관", "#f0c64f", "crown"],
];

function disposeScene(scene) {
  const geometry = new Set(),
    materials = new Set();
  scene.traverse((object) => {
    if (object.geometry) geometry.add(object.geometry);
    if (object.material) materials.add(object.material);
  });
  for (const value of geometry) value.dispose();
  for (const value of materials) value.dispose();
}

test("100-item catalog preserves saved items and exposes every item to the game", () => {
  assert.equal(ITEMS.length, 100);
  assert.equal(new Set(ITEMS.map((item) => item.id)).size, 100);
  assert.equal(new Set(ITEMS.map((item) => item.name)).size, 100);
  assert.equal(configuredItems, ITEMS);
  assert.deepEqual(
    Object.fromEntries(
      ["body", "trail", "spray"].map((type) => [
        type,
        ITEMS.filter((item) => item.type === type).length,
      ]),
    ),
    { body: 35, trail: 31, spray: 34 },
  );
  for (const [id, rarity, name, color, style] of original) {
    const expected = { id, type: id.split("-")[0], rarity, name, color, style };
    if (Object.values(STARTER_EQUIPPED).includes(id)) expected.starter = true;
    assert.deepEqual(ITEM_BY_ID.get(id), expected);
  }
  assert.equal(ITEMS.filter((item) => item.starter).length, 3);
  for (const item of ITEMS) {
    assert.match(item.id, /^(body|trail|spray)-[a-z0-9-]+$/);
    assert.match(item.color, /^#[a-f0-9]{6}$/);
    assert.ok(["common", "rare", "epic", "legendary"].includes(item.rarity));
    assert.ok(
      { body: BODY_STYLES, trail: TRAIL_STYLES, spray: SPRAY_STYLES }[
        item.type
      ].includes(item.style),
      item.id,
    );
    assert.equal(ITEM_BY_ID.get(item.id), item);
  }
});

test("every body unlock selects exactly one supported, independently colored shell", () => {
  const car = new THREE.Group();
  const carBody = new THREE.Group();
  car.add(carBody);
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial(),
  );
  base.userData.isBody = true;
  carBody.add(base);
  installCarBodies(carBody);
  for (const item of ITEMS.filter((item) => item.type === "body")) {
    applyCarCosmetics(car, { ...STARTER_EQUIPPED, body: item.id });
    assert.deepEqual(
      BODY_STYLES.filter(
        (style) => car.getObjectByName(`body-${style}`).visible,
      ),
      [item.style],
    );
    car.traverse((object) => {
      if (object.userData.isBody)
        assert.equal(object.material.color.getHexString(), item.color.slice(1));
      if (object.geometry)
        for (const value of object.geometry.attributes.position.array)
          assert.ok(Number.isFinite(value));
    });
  }
  disposeScene(car);
});

test("every trail style emits its intended geometry and expires cleanly", () => {
  const expected = {
    dust: "IcosahedronGeometry",
    bubbles: "SphereGeometry",
    stars: "ExtrudeGeometry",
    rainbow: "BoxGeometry",
    leaves: "ShapeGeometry",
    sparks: "ConeGeometry",
    hearts: "ExtrudeGeometry",
    snow: "ShapeGeometry",
    petals: "SphereGeometry",
    embers: "IcosahedronGeometry",
    diamonds: "OctahedronGeometry",
    confetti: "BoxGeometry",
  };
  for (const style of TRAIL_STYLES) {
    const scene = new THREE.Scene(),
      car = new THREE.Group();
    car.userData.cosmetics = {
      trail: ITEMS.find((item) => item.type === "trail" && item.style === style)
        .id,
    };
    const effects = createCosmeticsEffects(scene);
    effects.trail(car, 5, 0.1, 1);
    const particles = scene
      .getObjectByName("cosmetic-effects")
      .children.filter((object) => object.visible);
    assert.equal(particles.length, style === "none" ? 0 : 2, style);
    for (const particle of particles) {
      assert.equal(particle.geometry.type, expected[style]);
      assert.ok(Number.isFinite(particle.material.emissiveIntensity));
    }
    effects.update(2, 3);
    assert.ok(
      scene
        .getObjectByName("cosmetic-effects")
        .children.every((object) => !object.visible),
    );
    effects.dispose();
    disposeScene(scene);
  }
});

test("every spray style draws a distinct finite sticker for both the map and collection preview", () => {
  const previousDocument = globalThis.document;
  const signatures = new Set();
  const methods = new Set([
    "translate",
    "beginPath",
    "ellipse",
    "fill",
    "moveTo",
    "lineTo",
    "closePath",
    "arc",
    "stroke",
    "bezierCurveTo",
    "save",
    "restore",
    "rotate",
    "roundRect",
    "fillRect",
  ]);
  try {
    for (const style of SPRAY_STYLES) {
      const trace = [];
      const context = new Proxy(
        {},
        {
          get(target, key) {
            if (key in target) return target[key];
            assert.ok(
              methods.has(key),
              `Unknown drawing method ${String(key)}`,
            );
            return (...args) => {
              for (const value of args.flat())
                if (typeof value === "number")
                  assert.ok(Number.isFinite(value));
              trace.push([key, ...args]);
            };
          },
        },
      );
      const canvas = { width: 0, height: 0, getContext: () => context };
      globalThis.document = {
        createElement: (tag) => {
          assert.equal(tag, "canvas");
          return canvas;
        },
      };
      assert.equal(
        createSprayCanvas(
          ITEMS.find((item) => item.type === "spray" && item.style === style),
        ),
        canvas,
      );
      assert.equal(canvas.width, 256);
      assert.equal(canvas.height, 256);
      signatures.add(JSON.stringify(trace));
    }
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
  assert.equal(
    signatures.size,
    SPRAY_STYLES.length,
    "Each style needs its own drawing, not a fallback hand",
  );
});
