import * as THREE from "three";
import {
  TRACK,
  TRACK_LENGTH,
  CONNECTOR,
  trackPoint,
  LAP_REWARD,
  CRATE_COST,
} from "./gameConfig.js";

export function createRailWorld(scene, { reducedMotion = false } = {}) {
  const root = new THREE.Group();
  root.name = "loop-railway";
  scene.add(root);
  const materials = new Map();
  const neonMaterials = [];
  let night = 0;
  let lastElapsed = 0;
  let rewardStartedAt = -Infinity;
  function neon(dayColor, lightColor, peak) {
    const material = new THREE.MeshStandardMaterial({
      color: dayColor,
      emissive: lightColor,
      emissiveIntensity: 0.025,
      roughness: 0.6,
    });
    neonMaterials.push({ material, peak });
    return material;
  }
  const outerNeon = neon("#e7e9d1", "#85e5ff", 3.1);
  const innerNeon = neon("#e4dbdf", "#c4a0ff", 4.2);
  const checkpointNeon = neon("#aec98c", "#b6dfff", 2.7);
  const startNeon = neon("#f7efda", "#d0efff", 3.2);
  function mat(color) {
    if (!materials.has(color))
      materials.set(
        color,
        new THREE.MeshStandardMaterial({ color, roughness: 0.84 }),
      );
    return materials.get(color);
  }
  function mesh(geometry, color, parent = root, x = 0, y = 0, z = 0) {
    const result = new THREE.Mesh(
      geometry,
      typeof color === "string" ? mat(color) : color,
    );
    result.position.set(x, y, z);
    result.castShadow = true;
    result.receiveShadow = true;
    parent.add(result);
    return result;
  }
  function box(w, h, d, color, parent = root, x = 0, y = 0, z = 0) {
    return mesh(new THREE.BoxGeometry(w, h, d), color, parent, x, y, z);
  }
  class TrackCurve extends THREE.Curve {
    constructor(y, offset = 0, entranceGap = false) {
      super();
      this.y = y;
      this.offset = offset;
      this.entranceGap = entranceGap;
    }
    getPoint(t, target = new THREE.Vector3()) {
      const gap = this.entranceGap ? 5.1 / TRACK_LENGTH : 0;
      const p = trackPoint(gap + t * (1 - gap * 2));
      return target.set(
        p.x + Math.cos(p.heading) * this.offset,
        this.y,
        p.z - Math.sin(p.heading) * this.offset,
      );
    }
  }
  // A rounded tube carries a flat, broad top, so the rail reads as a sculptural
  // cylinder while every visible driving lane has the same ground height.
  mesh(new THREE.TubeGeometry(new TrackCurve(-2), 180, 2, 14, true), "#b7c486");
  const positions = [],
    indices = [];
  for (let i = 0; i <= 200; i++) {
    const p = trackPoint(i / 200);
    for (const side of [-1, 1])
      positions.push(
        p.x + Math.cos(p.heading) * TRACK.halfWidth * side,
        0.015,
        p.z - Math.sin(p.heading) * TRACK.halfWidth * side,
      );
    if (i < 200) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const surface = new THREE.BufferGeometry();
  surface.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  surface.setIndex(indices);
  surface.computeVertexNormals();
  const deck = mesh(
    surface,
    new THREE.MeshStandardMaterial({
      color: "#e3dfb6",
      roughness: 0.93,
      side: THREE.DoubleSide,
    }),
  );
  deck.castShadow = false;
  for (const side of [-1, 1]) {
    mesh(
      new THREE.TubeGeometry(
        new TrackCurve(0.045, side * 1.93, side > 0),
        180,
        0.075,
        6,
        side < 0,
      ),
      side > 0 ? outerNeon : innerNeon,
    );
    mesh(
      new THREE.TubeGeometry(
        new TrackCurve(-0.34, side * 1.94, side > 0),
        180,
        0.045,
        5,
        side < 0,
      ),
      "#728d61",
    );
  }
  for (let i = 0; i < 66; i++) {
    const p = trackPoint(i / 66);
    const dash = box(0.09, 0.02, 0.52, "#98a378", root, p.x, 0.039, p.z);
    dash.rotation.y = p.heading;
  }
  for (const progress of [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]) {
    const p = trackPoint(progress);
    const stripe = box(
      3.65,
      0.025,
      0.13,
      checkpointNeon,
      root,
      p.x,
      0.045,
      p.z,
    );
    stripe.rotation.y = p.heading;
  }
  for (let i = 0; i < 12; i++) {
    const p = trackPoint((i + 0.5) / 12);
    const arrow = new THREE.Group();
    arrow.position.set(p.x, 0.075, p.z);
    arrow.rotation.y = p.heading;
    root.add(arrow);
    for (const side of [-1, 1]) {
      const arm = box(0.19, 0.025, 0.95, "#718d54", arrow, side * 0.31, 0, 0);
      arm.rotation.y = (-side * Math.PI) / 4;
    }
  }
  for (let i = 0; i < 14; i++) {
    const p = trackPoint(i / 14);
    const leg = mesh(
      new THREE.CylinderGeometry(0.21, 0.32, 1.1, 7),
      "#8caa7d",
      root,
      p.x,
      -2.75,
      p.z,
    );
    leg.receiveShadow = false;
    box(1.05, 0.15, 0.85, "#a4b586", root, p.x, -3.3, p.z);
  }

  // Keep the entire connector open: only a broad, unadorned driving floor.
  const bridgeWidth = CONNECTOR.halfWidth * 2 + 1;
  const bridgeLength = CONNECTOR.endZ - CONNECTOR.startZ + 0.6;
  const bridgeZ = (CONNECTOR.startZ + CONNECTOR.endZ) / 2;
  box(bridgeWidth, 0.45, bridgeLength, "#bec899", root, 0, -0.235, bridgeZ);
  box(bridgeWidth, 0.08, bridgeLength, "#eee3bf", root, 0, -0.025, bridgeZ);
  // Checkered line runs across the lane; the positive X direction starts a lap.
  for (let x = 0; x < 2; x++)
    for (let z = 0; z < 10; z++) {
      box(
        0.26,
        0.028,
        0.38,
        (x + z) % 2 ? startNeon : "#536d56",
        root,
        -0.13 + x * 0.26,
        0.048,
        27.29 + z * 0.38,
      );
    }
  function label(text, sub, x, z, width, height, vertical = false) {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 384;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#edf0cf";
    ctx.fillRect(0, 0, 1024, 384);
    ctx.fillStyle = "#365642";
    ctx.textAlign = "center";
    ctx.font = "900 102px Arial";
    ctx.fillText(text, 512, 166);
    ctx.font = "600 46px Arial";
    ctx.fillText(sub, 512, 267);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const plane = mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshStandardMaterial({
        map: texture,
        side: THREE.DoubleSide,
        roughness: 1,
      }),
      root,
      x,
      vertical ? 2.4 : 0.055,
      z,
    );
    if (!vertical) plane.rotation.x = -Math.PI / 2;
    return plane;
  }
  label(
    "THE LITTLE LOOP",
    `LAP +${LAP_REWARD} C  /  ${CRATE_COST / LAP_REWARD} LAPS = 1 CRATE`,
    0,
    34,
    11,
    3.6,
  );
  const coinMaterial = new THREE.MeshStandardMaterial({
    color: "#ffd24f",
    emissive: "#ffce24",
    emissiveIntensity: 1.05,
    roughness: 0.5,
    metalness: 0.12,
  });
  const coinRimMaterial = new THREE.MeshStandardMaterial({
    color: "#fff0a0",
    emissive: "#ffe46a",
    emissiveIntensity: 1.25,
    roughness: 0.6,
  });
  const coinGeometry = new THREE.CylinderGeometry(0.5, 0.5, 0.13, 24);
  const coinRimGeometry = new THREE.TorusGeometry(0.38, 0.027, 6, 32);
  const coinMarkGeometry = new THREE.BoxGeometry(0.072, 0.018, 0.35);
  const coins = [];
  for (const [index, x] of [-9.6, 9.6].entries()) {
    const floating = new THREE.Group();
    floating.name = `rail-reward-coin-${index}`;
    floating.position.set(x, 1.75, 34);
    floating.scale.setScalar(2.3);
    root.add(floating);
    const coin = mesh(coinGeometry, coinMaterial, floating);
    coin.name = "rail-reward-coin-body";
    coin.rotation.x = Math.PI / 2;
    for (const side of [-1, 1]) {
      const rim = mesh(
        coinRimGeometry,
        coinRimMaterial,
        coin,
        0,
        side * 0.076,
        0,
      );
      rim.rotation.x = Math.PI / 2;
      mesh(coinMarkGeometry, coinRimMaterial, coin, 0, side * 0.077, 0);
    }
    coins.push(floating);
    box(1.25, 0.19, 1.25, "#c3bf95", root, x, 0.11, 34);
  }

  function animateCoins(elapsed) {
    const age = elapsed - rewardStartedAt;
    const pulse = age >= 0 && age < 1 ? Math.sin(age * Math.PI) ** 2 : 0;
    coinMaterial.emissiveIntensity = 1.05 + night * 1.65 + pulse * 0.7;
    coinRimMaterial.emissiveIntensity = 1.25 + night * 1.8 + pulse * 0.85;
    const bob = reducedMotion
      ? 0
      : Math.sin((elapsed % ((Math.PI * 2) / 1.25)) * 1.25) * 0.27;
    const rotation = reducedMotion
      ? 0
      : (elapsed % ((Math.PI * 2) / 0.32)) * 0.32;
    const scale = 2.3 * (1 + (reducedMotion ? 0 : pulse * 0.1));
    for (const coin of coins) {
      coin.position.y = 1.75 + bob;
      coin.rotation.y = rotation;
      coin.scale.setScalar(scale);
    }
  }

  return {
    setNight(value) {
      night = Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0;
      for (const entry of neonMaterials)
        entry.material.emissiveIntensity = 0.025 + night * (entry.peak - 0.025);
      animateCoins(lastElapsed);
    },
    getBumpers: () => [],
    hitBumper: () => null,
    playBumper() {},
    reward(elapsed = lastElapsed) {
      rewardStartedAt =
        Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : lastElapsed;
      animateCoins(lastElapsed);
    },
    update(_dt, elapsed) {
      if (Number.isFinite(elapsed) && elapsed >= 0) lastElapsed = elapsed;
      animateCoins(lastElapsed);
    },
  };
}
