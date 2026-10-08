import * as THREE from "three";
import { findWorldPath } from "./railNavigation.js";
import { createAttractions } from "./attractions.js";
import { createRailWorld } from "./railWorld.js";
import { createDuelWorld } from "./duelWorld.js";
import { createArenaWorld } from "./arenaWorld.js";
import { createArenaCelebration } from "./arenaCelebration.js";
import {
  createFuelWorld,
  createFuelPrediction,
  fuelProximity,
  blocksGarageApproach,
} from "./fuelWorld.js";
import {
  FUEL,
  garagePoint,
  garageDoorContact,
  garageWallContact,
  isGarageDriveable,
  getFuelEconomy,
} from "./fuelConfig.js";
import {
  createSoccerWorld,
  soccerViewSize,
  soccerPoseTransfer,
} from "./soccerWorld.js";
import { SOCCER, isSoccerDriveable, clampSoccerPose } from "./soccerConfig.js";
import {
  SOCCER_IMPACT_DRAG,
  resolveSoccerWall,
  applySoccerCarImpulse,
  soccerNavigationSpeed,
} from "./soccerDriving.js";
import {
  ARENA,
  ARENA_OBSTACLE_RULES,
  arenaGuardContact,
} from "./arenaConfig.js";
import { DUEL_OBSTACLE_RULES } from "./duelObstacles.js";
import { createNightLights } from "./nightLights.js";
import { createBloom } from "./bloom.js";
import { getLightingState, createLightingClock } from "./dayCycle.js";
import {
  getVehicleProfile,
  advanceDriveSpeed,
  smoothSteering,
  obstacleResponse,
} from "./vehicleDynamics.js";
import {
  installCarBodies,
  applyCarCosmetics,
  createCosmeticsEffects,
} from "./cosmeticsWorld.js";
import {
  STARTER_EQUIPPED,
  ITEM_BY_ID,
  TRACK,
  trackPoint,
  projectTrack,
  isDriveable,
  DUEL_TRACK,
  duelPoint,
  projectDuel,
  recoveryHeading,
} from "./gameConfig.js";

export const ZONES = [
  {
    id: "work",
    title: "오늘의 한 장",
    subtitle: "사진을 같이 나눠요",
    x: 1,
    z: -7,
    color: "#a9bec4",
  },
  {
    id: "about",
    title: "차량 정비소",
    subtitle: "내 차를 꾸미는 공간",
    x: -8,
    z: -1,
    color: "#dba68b",
  },
  {
    id: "play",
    title: "같이 놀자",
    subtitle: "콜로세움의 마지막 한 대",
    x: 8,
    z: 4,
    color: "#b7ba90",
  },
];
const START = { x: 1.3, z: 7.8, heading: -Math.PI / 2.4 };
const HOME_FOCUS = { x: 1.5, y: 2.5, z: 4 };

export function createWorld(host, callbacks) {
  const scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);
  host.appendChild(renderer.domElement);
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute(
    "aria-label",
    "우리들의 아지트. 우클릭으로 이동하거나 WASD와 방향키로 운전하세요.",
  );
  const camera = new THREE.OrthographicCamera(-25, 25, 15, -15, 0.1, 160);
  const postProcessing = createBloom(renderer, scene, camera);
  const openedAt = performance.now();
  const lightingClock = createLightingClock();
  let lighting = { ...getLightingState(0), automatic: true };
  const target = new THREE.Vector3(
    HOME_FOCUS.x + START.x * 0.22,
    HOME_FOCUS.y,
    HOME_FOCUS.z + START.z * 0.2,
  );
  const cameraOffset = new THREE.Vector3(24, 29, 32);
  const materials = new Map();
  function mat(color, extra = {}) {
    if (Object.keys(extra).length)
      return new THREE.MeshStandardMaterial({
        color,
        roughness: 0.85,
        ...extra,
      });
    if (!materials.has(color))
      materials.set(
        color,
        new THREE.MeshStandardMaterial({ color, roughness: 0.88 }),
      );
    return materials.get(color);
  }
  function mesh(geometry, color, parent = scene, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(
      geometry,
      typeof color === "string" || typeof color === "number"
        ? mat(color)
        : color,
    );
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  function box(w, h, d, color, parent = scene, x = 0, y = 0, z = 0) {
    return mesh(new THREE.BoxGeometry(w, h, d), color, parent, x, y, z);
  }
  function cylinder(
    r1,
    r2,
    height,
    color,
    parent = scene,
    x = 0,
    y = 0,
    z = 0,
    segments = 32,
  ) {
    return mesh(
      new THREE.CylinderGeometry(r1, r2, height, segments),
      color,
      parent,
      x,
      y,
      z,
    );
  }
  function group(x, y, z, rotation = 0) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = rotation;
    scene.add(g);
    return g;
  }
  function signTexture(text, bg, fg, sub = "") {
    const c = document.createElement("canvas");
    c.width = 768;
    c.height = 384;
    const ctx = c.getContext("2d");
    if (bg) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, 768, 384);
    }
    ctx.fillStyle = fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "900 110px Arial";
    const lines = text.split("\n");
    lines.forEach((line, i) =>
      ctx.fillText(
        line,
        384,
        (sub ? 154 : 192) + (i - (lines.length - 1) / 2) * 125,
      ),
    );
    if (sub) {
      ctx.font = "400 27px Arial";
      ctx.fillText(sub, 384, 266);
    }
    const texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }
  function planeLabel(text, x, z, w, h, color) {
    const m = new THREE.MeshBasicMaterial({
      map: signTexture(text, null, color),
      transparent: true,
      depthWrite: false,
    });
    const p = mesh(new THREE.PlaneGeometry(w, h), m, scene, x, 0.05, z);
    p.rotation.x = -Math.PI / 2;
    p.receiveShadow = false;
    return p;
  }
  const ambient = new THREE.AmbientLight(0xfff5e3, 1.4);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xfff7dc, 3.2);
  sun.position.set(-15, 28, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -56,
    right: 56,
    top: 56,
    bottom: -56,
    near: 0.5,
    far: 160,
  });
  sun.shadow.normalBias = 0.03;
  sun.shadow.bias = -0.0001;
  sun.shadow.radius = 5;
  scene.add(sun);
  const hemisphere = new THREE.HemisphereLight(0xc8e8ec, 0xc8a678, 1.1);
  scene.add(hemisphere);

  // Everything is real geometry: a little model you can drive around.
  cylinder(22.2, 21.6, 1.3, "#d6c39c", scene, 0, -0.82, 0, 96);
  cylinder(22.2, 22.2, 0.32, "#e8dbbc", scene, 0, -0.18, 0, 96);
  // A transparent ground catches model shadows while the page supplies its
  // original day/night palette and subtle gradient behind the scene.
  const shadowGround = new THREE.Mesh(
    new THREE.PlaneGeometry(600, 600),
    new THREE.ShadowMaterial({ opacity: 0.12, depthWrite: false }),
  );
  shadowGround.name = "island-shadow-ground";
  shadowGround.rotation.x = -Math.PI / 2;
  shadowGround.position.y = -1.82;
  shadowGround.receiveShadow = true;
  scene.add(shadowGround);
  const road = mesh(
    new THREE.RingGeometry(9.65, 12.05, 128),
    "#f6ecd6",
    scene,
    0,
    0.005,
    0,
  );
  road.rotation.x = -Math.PI / 2;
  road.castShadow = false;
  const outer = mesh(
    new THREE.RingGeometry(12.08, 12.15, 128),
    "#d8c7a5",
    scene,
    0,
    0.012,
    0,
  );
  outer.rotation.x = -Math.PI / 2;
  const outerRoad = mesh(
    new THREE.RingGeometry(18.8, 20.8, 128),
    "#f6ecd6",
    scene,
    0,
    0.01,
    0,
  );
  outerRoad.rotation.x = -Math.PI / 2;
  outerRoad.castShadow = false;
  for (let i = 0; i < 84; i++) {
    const a = (i / 84) * Math.PI * 2;
    const dash = box(
      0.07,
      0.012,
      0.55,
      "#c7bfa6",
      scene,
      Math.sin(a) * 19.8,
      0.025,
      Math.cos(a) * 19.8,
    );
    dash.rotation.y = a + Math.PI / 2;
  }
  for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const link = box(
      2,
      0.019,
      7.5,
      "#f4e8cd",
      scene,
      Math.sin(a) * 15.3,
      0.012,
      Math.cos(a) * 15.3,
    );
    link.rotation.y = a;
  }
  for (let i = 0; i < 52; i++) {
    const a = (i / 52) * Math.PI * 2;
    const dash = box(
      0.075,
      0.015,
      0.47,
      "#c7bfa6",
      scene,
      Math.sin(a) * 10.85,
      0.025,
      Math.cos(a) * 10.85,
    );
    dash.rotation.y = a + Math.PI / 2;
  }
  const path1 = box(2.15, 0.024, 9.3, "#f4e8cd", scene, 0.3, 0.012, -4.4);
  path1.rotation.y = -0.06;
  const path2 = box(14, 0.023, 1.9, "#f4e8cd", scene, -1.2, 0.014, 1.35);
  path2.rotation.y = -0.25;
  planeLabel("HELLO,\nFRIENDS.", -1, 3.5, 8.8, 4.4, "#527259");
  planeLabel("TAKE THE SCENIC ROUTE", -0.5, 6.1, 6, 0.72, "#aa9873");

  const colliders = [];
  function tree(x, z, s = 1, kind = 0) {
    const t = group(x, 0, z, x * 3);
    cylinder(0.13 * s, 0.18 * s, 1.4 * s, "#917250", t, 0, 0.7 * s, 0, 6);
    if (kind) {
      mesh(
        new THREE.IcosahedronGeometry(0.9 * s, 1),
        "#728b59",
        t,
        0,
        1.7 * s,
        0,
      );
      mesh(
        new THREE.IcosahedronGeometry(0.65 * s, 0),
        "#8d9c68",
        t,
        0.3 * s,
        2.3 * s,
        0,
      );
    } else {
      cylinder(0, 1.0 * s, 1.8 * s, "#536d4e", t, 0, 1.6 * s, 0, 6);
      cylinder(0, 0.8 * s, 1.7 * s, "#647d55", t, 0, 2.25 * s, 0, 6);
      cylinder(0, 0.57 * s, 1.5 * s, "#809465", t, 0, 2.87 * s, 0, 6);
    }
    colliders.push({ x, z, r: 0.5 * s, model: t });
  }
  [
    [-11, -6, 1.1],
    [-10, -7.6, 0.85],
    [-8.9, -9.2, 1.2],
    [-6.7, -11.2, 0.9],
    [-4.5, -12, 1.1],
    [-12, 0.8, 0.9],
    [-11.4, 3, 1.15],
    [-9.5, 7, 0.8],
    [5, -11.5, 1],
    [7, -10.2, 1.2],
    [9.2, -8.5, 0.82],
    [11.5, -5.3, 1],
    [12, -2.5, 0.9],
    [10, 7.9, 0.75],
    [-5, 10.9, 0.8],
  ].forEach(([x, z, s], i) => tree(x, z, s, i % 5 === 0));
  [
    [-17, -12, 1.2],
    [-13, -17, 1.35],
    [-10, -19, 1],
    [-6, -20.2, 1.15],
    [3, -20, 1],
    [6, -19.5, 1.35],
    [12, -17, 1.3],
    [17, -12, 1.2],
    [20, -6, 1],
    [20, 5, 0.85],
    [17, 12, 1.1],
    [11, 18, 0.75],
    [-17, 12, 0.9],
    [-20, -5, 1.1],
  ].forEach(([x, z, s], i) => tree(x, z, s, i % 3 === 0));
  for (let i = 0; i < 38; i++) {
    const a = i * 2.399;
    const r = 12.6 + Math.sin(i * 72) * 0.5;
    const x = Math.cos(a) * r,
      z = Math.sin(a) * r;
    const rock = mesh(
      new THREE.DodecahedronGeometry(0.13 + (i % 4) / 18, 0),
      i % 2 ? "#c3bc9f" : "#a9ad8d",
      scene,
      x,
      0.1,
      z,
    );
    rock.scale.y = 0.65;
    if (i % 3 === 0) {
      const tuft = group(x + 0.3, 0, z + 0.3);
      for (let j = 0; j < 3; j++) {
        const blade = box(
          0.05,
          0.3 + j * 0.06,
          0.07,
          "#9ca474",
          tuft,
          j * 0.09,
          0.13,
          0,
        );
        blade.rotation.z = (j - 1) * 0.3;
      }
    }
  }

  // A miniature gallery with a sculptural poster and three plinths.
  const gallery = group(1, 0, -7, -0.08);
  box(6.3, 0.18, 4.1, "#c4ccc5", gallery, 0, 0.08, 0);
  box(4.6, 2.9, 0.22, "#315c50", gallery, 0, 1.6, -1.25);
  const poster = mesh(
    new THREE.PlaneGeometry(4.25, 2.5),
    new THREE.MeshStandardMaterial({
      map: signTexture("GOOD\nCOMPANY.", "#ced9b3", "#315442"),
      roughness: 1,
    }),
    gallery,
    0,
    1.6,
    -1.12,
  );
  for (const x of [-1.7, 1.7])
    box(0.16, 1.4, 0.16, "#355449", gallery, x, 0.7, -1.2);
  for (let i = 0; i < 3; i++) {
    box(1.2, 0.62, 1.2, "#f4eee0", gallery, (i - 1) * 1.65, 0.48, 1);
    const shape =
      i === 0
        ? new THREE.TorusKnotGeometry(0.35, 0.12, 50, 8)
        : i === 1
          ? new THREE.IcosahedronGeometry(0.46, 0)
          : new THREE.TorusGeometry(0.37, 0.12, 8, 24);
    const m = mesh(
      shape,
      ["#b47554", "#7794a1", "#b8b95f"][i],
      gallery,
      (i - 1) * 1.65,
      1.28,
      1,
    );
    m.rotation.set(0.2, 0.4, 0.3);
  }
  colliders.push({ x: 1, z: -7.6, r: 2.4 });

  // A tiny studio with a pitched terracotta roof, windows, and a bench.
  const cabin = group(-8, 0, -1, 0.16);
  box(4.9, 0.18, 4.3, "#d5c09c", cabin, 0, 0.08, 0);
  box(3.1, 2.05, 2.7, "#f0e2c4", cabin, 0, 1.15, -0.3);
  const roofGeo = new THREE.BufferGeometry();
  const verts = new Float32Array([
    -1.85, 0, -1.7, 1.85, 0, -1.7, 0, 1.2, -1.7, -1.85, 0, 1.7, 0, 1.2, 1.7,
    1.85, 0, 1.7, -1.85, 0, -1.7, 0, 1.2, -1.7, 0, 1.2, 1.7, -1.85, 0, -1.7, 0,
    1.2, 1.7, -1.85, 0, 1.7, 1.85, 0, -1.7, 1.85, 0, 1.7, 0, 1.2, 1.7, 1.85, 0,
    -1.7, 0, 1.2, 1.7, 0, 1.2, -1.7,
  ]);
  roofGeo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  roofGeo.computeVertexNormals();
  mesh(
    roofGeo,
    mat("#b77556", { side: THREE.DoubleSide }),
    cabin,
    0,
    2.2,
    -0.3,
  );
  box(0.58, 1.36, 0.08, "#486c59", cabin, 0.62, 0.85, 1.08);
  box(0.72, 0.78, 0.1, "#50777b", cabin, -0.62, 1.28, 1.08);
  box(0.77, 0.06, 0.15, "#faf1d9", cabin, -0.62, 1.28, 1.14);
  box(0.06, 0.83, 0.15, "#faf1d9", cabin, -0.62, 1.28, 1.14);
  cylinder(0.04, 0.04, 0.08, "#d9b15d", cabin, 0.78, 0.84, 1.15, 8).rotation.x =
    Math.PI / 2;
  box(0.48, 1.3, 0.5, "#f1dcc1", cabin, 0.85, 2.55, -0.7);
  for (let i = 0; i < 3; i++)
    box(1.6, 0.08, 0.13, "#a17650", cabin, 2, 0.68, 1 + i * 0.2);
  for (const x of [1.4, 2.6])
    box(0.09, 0.6, 0.6, "#546a56", cabin, x, 0.3, 1.2);
  colliders.push({ x: -8, z: -1.3, r: 1.9 });
  tree(-5.4, -2.8, 0.8, 1);

  const play = group(8, 0, 4, -0.1);
  cylinder(2.7, 2.7, 0.1, "#c2c79a", play, 0, 0.03, 0, 48);
  cylinder(1.1, 1.1, 0.28, "#536d54", play, 0.1, 0.22, 0, 32);
  cylinder(1, 1, 0.05, "#354c47", play, 0.1, 0.39, 0, 32);
  const tring = mesh(
    new THREE.TorusGeometry(1.02, 0.1, 8, 48),
    "#e7dcb9",
    play,
    0.1,
    0.42,
    0,
  );
  tring.rotation.x = Math.PI / 2;
  const balls = [];
  [
    [-1.7, 0.5, 0.72, "#d88662"],
    [1.6, 0.5, 1, "#e1c269"],
    [0.8, 0.38, -1.9, "#8bacc0"],
  ].forEach(([x, y, z, c]) =>
    balls.push(mesh(new THREE.IcosahedronGeometry(y, 1), c, play, x, y, z)),
  );
  const arch = group(8, 0, 1.4);
  for (const x of [-1.1, 1.1])
    cylinder(0.1, 0.1, 2.1, "#b86d55", arch, x, 1, 0, 8);
  const archtop = mesh(
    new THREE.TorusGeometry(1.1, 0.1, 8, 32, Math.PI),
    "#b86d55",
    arch,
    0,
    2,
    0,
  );
  const flag = box(0.8, 0.4, 0.05, "#d9a356", arch, 0, 2.8, 0);
  flag.rotation.z = 0.1;

  // Quiet details reward taking the long way around.
  const windmill = group(5, 0, -2.1);
  cylinder(0.12, 0.3, 3, "#f2e9d7", windmill, 0, 1.5, 0, 8);
  const blades = new THREE.Group();
  blades.position.set(0, 3, 0.17);
  windmill.add(blades);
  cylinder(0.18, 0.18, 0.3, "#8d9b86", blades, 0, 0, 0, 10).rotation.x =
    Math.PI / 2;
  for (let i = 0; i < 3; i++) {
    const arm = box(0.17, 1.6, 0.07, "#f5eee0", blades, 0, 0, 0);
    arm.geometry.translate(0, 0.7, 0);
    arm.rotation.z = (i * Math.PI * 2) / 3;
  }
  const fence = group(-4, 0, 9.2, -0.35);
  for (let i = 0; i < 5; i++)
    box(0.13, 0.65, 0.13, "#9d8056", fence, i * 0.62, 0.33, 0);
  box(2.65, 0.12, 0.1, "#ae8b5b", fence, 1.2, 0.49, 0);
  function cone(x, z) {
    const g = group(x, 0, z);
    box(0.5, 0.07, 0.5, "#f1e9d5", g, 0, 0.04, 0);
    cylinder(0.055, 0.19, 0.53, "#ce8455", g, 0, 0.33, 0, 10);
    cylinder(0.11, 0.14, 0.12, "#fff2da", g, 0, 0.32, 0, 10);
  }
  cone(3.3, 7.1);
  cone(3.9, 7.7);
  cone(4.5, 8.3);
  const finish = box(1.9, 0.023, 0.55, "#e4dbc4", scene, 0, 0.025, 10.8);
  for (let x = 0; x < 6; x++)
    for (let z = 0; z < 2; z++)
      if ((x + z) % 2 === 0)
        box(
          0.3,
          0.024,
          0.25,
          "#8f9880",
          scene,
          -0.75 + x * 0.3,
          0.043,
          10.66 + z * 0.26,
        );

  const car = group(START.x, 0, START.z, START.heading);
  const carBody = new THREE.Group();
  carBody.name = "car-body";
  car.add(carBody);
  box(1.13, 0.28, 1.9, "#91ae80", carBody, 0, 0.49, 0);
  box(1.05, 0.27, 0.72, "#abc692", carBody, 0, 0.7, 0.56);
  box(1.05, 0.15, 0.45, "#aac98c", carBody, 0, 0.72, -0.7);
  box(0.93, 0.59, 0.82, "#bfd1a2", carBody, 0, 0.96, -0.1);
  box(0.85, 0.38, 0.045, "#486c65", carBody, 0, 1.02, 0.335);
  box(0.85, 0.36, 0.045, "#496b61", carBody, 0, 1.02, -0.535);
  for (const x of [-0.483, 0.483])
    box(0.025, 0.38, 0.64, "#557972", carBody, x, 1.01, -0.1);
  box(1.05, 0.12, 0.98, "#cfdbac", carBody, 0, 1.29, -0.11);
  for (const x of [-0.42, 0.42]) {
    box(0.2, 0.15, 0.05, "#fff0bd", carBody, x, 0.6, 0.978);
    box(0.18, 0.12, 0.05, "#b96845", carBody, x, 0.56, -0.978);
  }
  box(1.15, 0.14, 0.16, "#354e45", carBody, 0, 0.35, 1);
  box(1.15, 0.14, 0.16, "#354e45", carBody, 0, 0.35, -1);
  box(0.42, 0.13, 0.06, "#395348", carBody, 0, 0.55, 0.99);
  const wheels = [];
  for (const x of [-0.59, 0.59])
    for (const z of [-0.64, 0.64]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.31, z);
      car.add(pivot);
      const tire = cylinder(0.32, 0.32, 0.24, "#36463f", pivot, 0, 0, 0, 14);
      tire.rotation.z = Math.PI / 2;
      const hub = cylinder(0.17, 0.17, 0.253, "#cfceb9", pivot, 0, 0, 0, 12);
      hub.rotation.z = Math.PI / 2;
      wheels.push({ pivot, tire, hub, front: z > 0 });
    }
  const spare = cylinder(
    0.29,
    0.29,
    0.2,
    "#36463f",
    carBody,
    0,
    0.83,
    -1.02,
    14,
  );
  spare.rotation.x = Math.PI / 2;
  const aerial = cylinder(
    0.013,
    0.013,
    0.61,
    "#385648",
    carBody,
    0.39,
    1.58,
    -0.44,
    5,
  );
  const pennant = mesh(
    new THREE.BufferGeometry().setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, 0.35, -0.1, 0, 0, -0.2, 0], 3),
    ),
    mat("#f4cd65", { side: THREE.DoubleSide }),
    carBody,
    0.39,
    1.86,
    -0.44,
  );
  installCarBodies(carBody);
  const carVisual = new THREE.Group();
  carVisual.name = "car-visual";
  for (const child of [...car.children]) carVisual.add(child);
  car.add(carVisual);
  const dust = [];
  const dustGeo = new THREE.IcosahedronGeometry(0.14, 0);
  for (let i = 0; i < 20; i++) {
    const m = mesh(
      dustGeo,
      mat("#e1cfaa", { transparent: true, opacity: 0 }),
      scene,
    );
    m.visible = false;
    dust.push({ m, life: 0 });
  }
  car.traverse((o) => {
    if (
      o.isMesh &&
      (o.userData.isBody ||
        ["91ae80", "abc692", "aac98c", "bfd1a2", "cfdbac"].includes(
          o.material.color?.getHexString(),
        ))
    ) {
      if (!o.userData.isBody) o.material = o.material.clone();
      o.userData.isBody = true;
    }
  });
  let localId = null;
  let localColor = "#a5bf90";
  let equipped = { ...STARTER_EQUIPPED };
  // Local-only solo test drives never grant inventory or override a joined
  // player's server-confirmed equipment.
  const previewBodyId = import.meta.env.DEV
    ? new URLSearchParams(window.location.search).get("vehicle")
    : null;
  const previewBody = ITEM_BY_ID.get(previewBodyId);
  const soloEquipment = (value) =>
    !localId && previewBody?.type === "body"
      ? { ...value, body: previewBody.id }
      : value;
  equipped = soloEquipment(equipped);
  applyCarCosmetics(car, equipped, localColor);
  const cosmeticEffects = createCosmeticsEffects(scene);
  const remoteCars = new Map();
  function updatePeers(peers) {
    const ids = new Set(peers.map((p) => p.id));
    for (const [id, p] of remoteCars) {
      if (!ids.has(id)) {
        scene.remove(p.model);
        for (const m of p.ownedMaterials) m.dispose();
        remoteCars.delete(id);
      }
    }
    for (const peer of peers) {
      let p = remoteCars.get(peer.id);
      if (!p) {
        const model = car.clone(true);
        const ownedMaterials = [];
        model.traverse((o) => {
          if (o.isMesh && o.userData.isBody) {
            o.material = o.material.clone();
            o.material.color
              .set(peer.color)
              .lerp(new THREE.Color("#ffffff"), 0.16);
            ownedMaterials.push(o.material);
          }
        });
        model.position.set(peer.x, 0, peer.z);
        model.getObjectByName("car-visual").position.y = 0;
        scene.add(model);
        p = { model, ownedMaterials, ...peer };
        remoteCars.set(peer.id, p);
      } else Object.assign(p, peer);
      const cosmeticsKey = JSON.stringify(peer.cosmetics || STARTER_EQUIPPED);
      if (p.cosmeticsKey !== cosmeticsKey) {
        applyCarCosmetics(p.model, peer.cosmetics, peer.color);
        p.cosmeticsKey = cosmeticsKey;
      }
    }
  }
  const keys = new Set();
  let speed = 0,
    steeringInput = 0,
    heading = START.heading,
    paused = false,
    frameId,
    prev = 0,
    elapsed = 0,
    lastUi = 0,
    dustIndex = 0,
    boost = false,
    near = null,
    driveTime = 0,
    hasMoved = false,
    jump = 0,
    jumpVelocity = 0;
  const impactMotion = { x: 0, z: 0, spin: 0, roll: 0 };
  const seenImpacts = new Set();
  function clearImpact() {
    impactMotion.x = impactMotion.z = impactMotion.spin = impactMotion.roll = 0;
  }
  const attractions = createAttractions(scene);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const railway = createRailWorld(scene, { reducedMotion: reduced });
  const duelWorld = createDuelWorld(scene);
  const arenaWorld = createArenaWorld(scene, { reducedMotion: reduced });
  const arenaCelebration = createArenaCelebration(scene, {
    reducedMotion: reduced,
  });
  const soccerWorld = createSoccerWorld(scene, { reducedMotion: reduced });
  const fuelWorld = createFuelWorld(scene);
  const fuelPrediction = createFuelPrediction();
  const fuelCars = new Map();
  let fuel = null,
    fuelClockOffset = 0,
    manualBoost = false;
  let activeColliders = colliders;
  let stealHeld = false,
    stealTarget = null,
    stealRequest = 0,
    stealBeganAt = 0,
    sawServerStealing = false;
  const fuelNow = () => Date.now() - fuelClockOffset;
  const fuelPlayer = () =>
    fuel?.players?.find((player) => player.id === localId);
  const occupiedGarages = () => (localId ? fuel?.garages || [] : []);
  const worldDriveable = (x, z) =>
    isDriveable(x, z) ||
    occupiedGarages().some((garage) => isGarageDriveable(x, z, garage.slot));
  const fuelAvailable = () => Boolean(localId && fuelPlayer());
  function refreshFuel() {
    fuelWorld.setFuel(localId ? fuel : null, localId);
    activeColliders = colliders.filter((collider) => {
      const blocked = blocksGarageApproach(collider, occupiedGarages());
      if (collider.model) collider.model.visible = !blocked;
      return !blocked;
    });
  }
  function fuelContext() {
    return fuelProximity(
      localId ? fuel : null,
      localId,
      car.position,
      fuelNow(),
    );
  }
  function fuelLocked() {
    return Boolean(
      paused ||
        document.hidden ||
        arenaPeek ||
        soccerPeek ||
        arenaMember() ||
        soccerMember() ||
        (race && (race.hostId === localId || race.guestId === localId)),
    );
  }
  function setFuelStealHeld(held, targetId) {
    if (!held) {
      const hadRequest = stealHeld || stealTarget;
      stealHeld = false;
      stealTarget = null;
      stealBeganAt = 0;
      sawServerStealing = false;
      stealRequest++;
      return hadRequest
        ? Promise.resolve(callbacks.onFuelAction?.("fuel:cancel", {})).catch(
            () => ({ ok: false }),
          )
        : Promise.resolve({ ok: true });
    }
    if (stealHeld) return Promise.resolve({ ok: true });
    const nearby = fuelContext().nearTheft;
    if (
      !fuelAvailable() ||
      fuelLocked() ||
      fuelPlayer()?.carrying ||
      !nearby ||
      (targetId && nearby.ownerId !== targetId) ||
      nearby.closed ||
      nearby.stored <= 0
    )
      return Promise.resolve({
        ok: false,
        message: "열린 차고의 연료통 가까이에서 길게 눌러 주세요.",
      });
    stealHeld = true;
    stealTarget = nearby.ownerId;
    stealBeganAt = fuelNow();
    sawServerStealing = false;
    const request = ++stealRequest;
    return Promise.resolve(
      callbacks.onFuelAction?.("fuel:steal", { targetId: stealTarget }),
    )
      .then((result) => {
        if (!result?.ok && request === stealRequest) {
          stealHeld = false;
          stealTarget = null;
          stealBeganAt = 0;
        }
        return result || { ok: false };
      })
      .catch(() => {
        if (request === stealRequest) {
          stealHeld = false;
          stealTarget = null;
          stealBeganAt = 0;
        }
        return { ok: false, message: "연결을 확인하고 다시 시도해 주세요." };
      });
  }
  const teamRingGeometry = new THREE.RingGeometry(1.04, 1.27, 32);
  teamRingGeometry.rotateX(-Math.PI / 2);
  const teamRings = Object.fromEntries(
    [
      ["blue", "#77c1f0"],
      ["orange", "#f3a366"],
    ].map(([team, color]) => {
      const rings = new THREE.InstancedMesh(
        teamRingGeometry,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
        }),
        SOCCER.maxPlayers,
      );
      rings.name = `soccer-${team}-team-markers`;
      rings.count = 0;
      rings.frustumCulled = false;
      scene.add(rings);
      return [team, rings];
    }),
  );
  const teamRingMatrix = new THREE.Matrix4();
  const nightLights = createNightLights(scene, car);
  applyCarCosmetics(car, equipped, localColor);
  let boostUntil = 0;
  let raceBoostUntil = 0;
  let race = null;
  let arena = null,
    arenaDisplay = null,
    arenaPeek = false,
    arenaFellAt = null;
  let arenaView = false,
    previousZoom = null,
    arenaViewRadius = ARENA.minRadius;
  let soccer = null,
    soccerDisplay = null,
    soccerPeek = false,
    soccerView = false,
    soccerTransfer = null;
  const remoteFalls = new Map();
  const arenaLive = (value) =>
    value && ["countdown", "running"].includes(value.status);
  const arenaMember = () =>
    arena?.players?.find((player) => player.id === localId);
  const insideArena = () => Boolean(arenaLive(arena) && arenaMember());
  const soccerLive = (value) =>
    value && ["countdown", "playing", "goal"].includes(value.status);
  const soccerMember = () =>
    soccer?.players?.some((player) => player.id === localId);
  const insideSoccer = () =>
    Boolean(
      soccerMember() &&
        soccerTransfer !== "leaving" &&
        (soccerLive(soccer) || soccerTransfer === "entering"),
    );
  function refreshViews(radiusChanged = false) {
    const nextArena = insideArena() || arenaPeek;
    const nextSoccer = !nextArena && (insideSoccer() || soccerPeek);
    const wasFocused = arenaView || soccerView;
    const focused = nextArena || nextSoccer;
    const changed =
      nextArena !== arenaView || nextSoccer !== soccerView || radiusChanged;
    if (focused !== wasFocused) {
      if (focused) {
        previousZoom = zoom;
        zoom = 1;
      } else {
        zoom = previousZoom ?? zoom;
        previousZoom = null;
      }
    }
    arenaView = nextArena;
    soccerView = nextSoccer;
    if (changed) resize();
  }
  function refreshSoccer() {
    soccerWorld.setMatch(soccerLive(soccer) ? soccer : soccerDisplay || soccer);
    refreshViews();
  }
  function setSoccerSpectating(value) {
    if (
      value &&
      (insideSoccer() ||
        insideArena() ||
        (race &&
          localId &&
          (race.hostId === localId || race.guestId === localId)))
    )
      return;
    soccerPeek = Boolean(value);
    if (soccerPeek) arenaPeek = false;
    clearInput();
    cancelNavigation();
    speed = boostUntil = 0;
    refreshSoccer();
  }
  function leaveSpectatorView() {
    if ((!arenaPeek || insideArena()) && (!soccerPeek || insideSoccer()))
      return false;
    arenaPeek = soccerPeek = false;
    refreshViews();
    return true;
  }
  function updateSoccerTeams() {
    const shown = soccerLive(soccer) ? soccer : soccerDisplay;
    for (const rings of Object.values(teamRings)) rings.count = 0;
    if (soccerLive(shown))
      for (const player of shown.players || []) {
        const rings = teamRings[player.team];
        const model =
          player.id === localId ? car : remoteCars.get(player.id)?.model;
        if (!rings || !model?.visible || rings.count >= SOCCER.maxPlayers)
          continue;
        rings.setMatrixAt(
          rings.count++,
          teamRingMatrix.makeTranslation(
            model.position.x,
            model.position.y + 0.08,
            model.position.z,
          ),
        );
      }
    for (const rings of Object.values(teamRings))
      rings.instanceMatrix.needsUpdate = true;
  }
  function setArenaSpectating(value) {
    if (
      value &&
      (insideArena() ||
        insideSoccer() ||
        (race &&
          localId &&
          (race.hostId === localId || race.guestId === localId)))
    )
      return;
    arenaPeek = Boolean(value);
    if (arenaPeek) soccerPeek = false;
    clearInput();
    cancelNavigation();
    speed = 0;
    boostUntil = 0;
    refreshArena();
  }
  function refreshArena() {
    const shown = arenaLive(arena) ? arena : arenaDisplay || arena;
    arenaWorld.setMatch(shown, localId);
    arenaCelebration.setRadius(shown?.radius || ARENA.minRadius);
    if (shown?.status === "running")
      arenaCelebration.celebrate("start", shown.id);
    const nextRadius = shown?.radius || ARENA.minRadius;
    const resized = nextRadius !== arenaViewRadius;
    arenaViewRadius = nextRadius;
    refreshViews(resized);
  }
  let recovering = 0;
  let waypoints = [];
  const destinationMarker = mesh(
    new THREE.RingGeometry(0.24, 0.36, 40),
    new THREE.MeshBasicMaterial({
      color: "#759743",
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    }),
    scene,
    0,
    0.075,
    0,
  );
  destinationMarker.rotation.x = -Math.PI / 2;
  destinationMarker.visible = false;
  destinationMarker.castShadow = false;
  const raycaster = new THREE.Raycaster(),
    pointer = new THREE.Vector2(),
    ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
    hit = new THREE.Vector3();
  function cancelNavigation() {
    waypoints = [];
    destinationMarker.visible = false;
  }
  function pointToDrive(event) {
    event.preventDefault();
    if (
      paused ||
      disposed ||
      (insideArena() &&
        (arenaMember()?.alive === false || arenaFellAt !== null))
    )
      return;
    if (leaveSpectatorView()) return;
    renderer.domElement.focus({ preventScroll: true });
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      (-(event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    if (
      !raycaster.ray.intersectPlane(ground, hit) ||
      (!(insideSoccer()
        ? isSoccerDriveable(hit.x, hit.z, -SOCCER.carRadius)
        : insideArena()
          ? Math.hypot(hit.x - ARENA.cx, hit.z - ARENA.cz) < arena.radius - 0.8
          : worldDriveable(hit.x, hit.z)) &&
        !(
          !insideArena() &&
          !insideSoccer() &&
          Math.abs(hit.x) <= 22 &&
          hit.z >= 24 &&
          hit.z <= 43
        ))
    )
      return;
    driveTo({ x: hit.x, z: hit.z });
  }
  function driveTo(destination) {
    if (insideSoccer())
      destination = clampSoccerPose(destination.x, destination.z);
    if (
      Math.hypot(
        destination.x - car.position.x,
        destination.z - car.position.z,
      ) < 0.2
    ) {
      cancelNavigation();
      return true;
    }
    const path =
      insideArena() || insideSoccer()
        ? [{ x: destination.x, z: destination.z }]
        : findWorldPath(
            { x: car.position.x, z: car.position.z },
            destination,
            activeColliders,
            { garages: occupiedGarages(), playerId: localId, now: fuelNow() },
          );
    if (!path.length) {
      cancelNavigation();
      callbacks.onNavigationError?.();
      return;
    }
    clearInput();
    waypoints = path;
    const last = path[path.length - 1];
    destinationMarker.position.set(last.x, 0.075, last.z);
    destinationMarker.visible = true;
    return true;
  }
  function driveToGarage(ownerId = localId) {
    if (!localId || fuelLocked()) return false;
    const garage = occupiedGarages().find((entry) => entry.ownerId === ownerId);
    if (!garage || (ownerId !== localId && garage.closedUntil > fuelNow()))
      return false;
    return driveTo(garagePoint(garage.slot, 0, -0.95)) === true;
  }
  const interactionSurface = host.parentElement;
  function onContextMenu(event) {
    if (
      event.target.closest(
        "header,footer,.chat-panel,.modal,.map-card,.top-right-tools,.social-controls,.touch-controls",
      )
    )
      return;
    pointToDrive(event);
  }
  interactionSurface.addEventListener("contextmenu", onContextMenu);
  let mobile = { throttle: 0, steer: 0, brake: false, boost: false };
  let audioContext = null,
    osc = null,
    gain = null,
    sound = false;
  let disposed = false;
  let debugCollisions = 0;
  const vec = new THREE.Vector3();
  let width = 1,
    height = 1;
  // Frame the west arena below the header with the island still near the center.
  let zoom = 2.22;
  const worldLabels = interactionSurface.querySelector(".world-labels");
  const worldHeader = interactionSurface.querySelector(":scope > header");
  const worldFooter = interactionSurface.querySelector(":scope > footer");
  const clippedWorldLayers = [host, worldLabels].filter(Boolean);
  function clipWorldToContent() {
    const bounds = interactionSurface.getBoundingClientRect();
    const top = worldHeader?.getBoundingClientRect().bottom ?? bounds.top;
    const bottom = worldFooter?.getBoundingClientRect().top ?? bounds.bottom;
    for (const layer of clippedWorldLayers) {
      const rect = layer.getBoundingClientRect();
      const inset = [
        Math.max(0, top - rect.top),
        Math.max(0, rect.right - bounds.right),
        Math.max(0, rect.bottom - bottom),
        Math.max(0, bounds.left - rect.left),
      ];
      layer.style.setProperty(
        "--world-content-clip",
        `inset(${inset.map((value) => `${value}px`).join(" ")})`,
      );
    }
  }
  function resize() {
    clipWorldToContent();
    width = host.clientWidth;
    height = host.clientHeight;
    renderer.setSize(width, height);
    postProcessing.resize(width, height);
    const aspect = width / height;
    const size = arenaView
      ? Math.max(arenaViewRadius * 2.8, 38) * Math.max(1, 1.25 / aspect) * zoom
      : soccerView
        ? soccerViewSize(width, height, interactionSurface.clientWidth) * zoom
        : (aspect < 1.2 ? 48 / aspect : 36) * zoom;
    worldLabels?.style.setProperty(
      "--place-label-scale",
      String(THREE.MathUtils.clamp(Math.sqrt(height / size / 22), 0.84, 1)),
    );
    camera.left = (-size * aspect) / 2;
    camera.right = (size * aspect) / 2;
    camera.top = size / 2;
    camera.bottom = -size / 2;
    // Orthographic distance does not change scale. Pull the camera back for
    // tall, zoomed-out views so the whole map remains in its frustum.
    const sceneDepthSpan = (size / 2) * (40 / 29);
    cameraOffset
      .set(24, 29, 32)
      .setLength(Math.max(Math.hypot(24, 29, 32), sceneDepthSpan + 20));
    camera.far = Math.max(160, cameraOffset.length() + sceneDepthSpan + 20);
    camera.updateProjectionMatrix();
  }
  function wheelZoom(e) {
    e.preventDefault();
    zoom = THREE.MathUtils.clamp(
      zoom + e.deltaY * 0.0007,
      arenaView || soccerView ? 0.85 : 0.55,
      3,
    );
    resize();
  }
  renderer.domElement.addEventListener("wheel", wheelZoom, { passive: false });
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  ro.observe(interactionSurface);
  if (worldHeader) ro.observe(worldHeader);
  if (worldFooter) ro.observe(worldFooter);
  resize();
  function clearInput() {
    keys.clear();
    steeringInput = 0;
    mobile = { throttle: 0, steer: 0, brake: false, boost: false };
    if (stealHeld || stealTarget) void setFuelStealHeld(false);
  }
  function stopInput() {
    clearInput();
    cancelNavigation();
  }
  function keydown(e) {
    if (
      paused ||
      (e.target instanceof HTMLElement &&
        e.target.closest('input,textarea,select,[contenteditable="true"]'))
    )
      return;
    if (
      ["Enter", "Space"].includes(e.code) &&
      e.target instanceof HTMLElement &&
      e.target.closest("button")
    )
      return;
    const accepted = [
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "KeyW",
      "KeyA",
      "KeyS",
      "KeyD",
      "Space",
      "ShiftLeft",
      "ShiftRight",
      "KeyR",
      "KeyE",
      "KeyT",
      "Enter",
    ];
    if (accepted.includes(e.code)) {
      e.preventDefault();
      keys.add(e.code);
      leaveSpectatorView();
    }
    if (e.repeat) return;
    if (e.code === "KeyR") reset();
    if (e.code === "KeyT") callbacks.onSpray?.();
    if (e.code === "KeyE" && fuelContext().nearTheft) {
      void setFuelStealHeld(true);
      return;
    }
    if ((e.code === "KeyE" || e.code === "Enter") && near)
      callbacks.onInteract(near);
  }
  function keyup(e) {
    keys.delete(e.code);
    if (e.code === "KeyE") void setFuelStealHeld(false);
  }
  window.addEventListener("keydown", keydown);
  window.addEventListener("keyup", keyup);
  window.addEventListener("blur", stopInput);
  document.addEventListener("visibilitychange", stopInput);
  function reset() {
    if (insideArena() || insideSoccer()) return;
    leaveSpectatorView();
    clearImpact();
    cancelNavigation();
    if (callbacks.onReset?.() === true) return;
    car.position.set(START.x, 0, START.z);
    heading = START.heading;
    speed = 0;
    jump = 0;
    jumpVelocity = 0;
    boostUntil = 0;
    recovering = 0;
    clearInput();
  }
  function soundOn(enabled) {
    sound = enabled;
    if (enabled) {
      try {
        audioContext ??= new AudioContext();
        audioContext.resume();
        if (!osc) {
          osc = audioContext.createOscillator();
          gain = audioContext.createGain();
          osc.type = "sine";
          gain.gain.value = 0.015;
          osc.connect(gain);
          gain.connect(audioContext.destination);
          osc.start();
        }
      } catch {
        sound = false;
      }
    }
    if (gain)
      gain.gain.setTargetAtTime(
        enabled ? 0.018 : 0,
        audioContext.currentTime,
        0.2,
      );
  }
  function project(x, y, z) {
    vec.set(x, y, z).project(camera);
    return { x: ((vec.x + 1) / 2) * width, y: ((1 - vec.y) / 2) * height };
  }
  function step(time) {
    if (disposed) return;
    frameId = requestAnimationFrame(step);
    const dt = Math.min((time - prev) / 1000 || 0.016, 0.04);
    prev = time;
    elapsed += dt;
    const clock = lightingClock.read((performance.now() - openedAt) / 1000);
    lighting = {
      ...getLightingState(clock.seconds),
      automatic: clock.automatic,
    };
    ambient.color.set(lighting.ambientColor);
    ambient.intensity = lighting.ambientIntensity;
    hemisphere.color.set(lighting.hemisphereSky);
    hemisphere.groundColor.set(lighting.hemisphereGround);
    hemisphere.intensity = lighting.hemiIntensity;
    sun.color.set(lighting.sunColor);
    sun.intensity = lighting.sunIntensity;
    sun.position.set(
      -15 + lighting.night * 10,
      28 - Math.sin(lighting.night * Math.PI) * 16,
      12,
    );
    renderer.toneMappingExposure = lighting.exposure;
    postProcessing.setStrength(lighting.bloomStrength);
    attractions.setNight(lighting.night);
    railway.setNight(lighting.night);
    duelWorld.setNight(lighting.night);
    arenaWorld.setNight(lighting.night);
    arenaCelebration.setNight(lighting.night);
    soccerWorld.setNight(lighting.night);
    recovering = Math.max(0, recovering - dt);
    const raceParticipant =
      race && localId && (race.hostId === localId || race.guestId === localId);
    const inArena = insideArena();
    const inSoccer = insideSoccer();
    const arenaEliminated =
      inArena && (arenaMember()?.alive === false || arenaFellAt !== null);
    const countdownLocked = Boolean(
      (inArena && arena.status === "countdown") ||
        (inSoccer && soccer.status !== "playing") ||
        (raceParticipant &&
          race.status === "countdown" &&
          Date.now() < race.startsAt),
    );
    const active =
      !paused &&
      !document.hidden &&
      !countdownLocked &&
      !arenaEliminated &&
      !(arenaPeek && !inArena) &&
      !(soccerPeek && !inSoccer) &&
      recovering === 0;
    const baseVehicle = getVehicleProfile(equipped.body);
    const carryingFuel = Boolean(fuelPlayer()?.carrying);
    const vehicle = carryingFuel
      ? {
          ...baseVehicle,
          topSpeed: baseVehicle.topSpeed * 0.8,
          boostSpeed: baseVehicle.boostSpeed * 0.8,
        }
      : baseVehicle;
    const drivingVehicle =
      elapsed < raceBoostUntil && elapsed < boostUntil
        ? { ...vehicle, boostSpeed: 20 }
        : vehicle;
    if (countdownLocked) {
      speed = 0;
      clearImpact();
    }
    let throttle = active
      ? (keys.has("ArrowUp") || keys.has("KeyW") ? 1 : 0) -
          (keys.has("ArrowDown") || keys.has("KeyS") ? 1 : 0) || mobile.throttle
      : 0;
    let steer = active
      ? (keys.has("ArrowLeft") || keys.has("KeyA") ? 1 : 0) -
          (keys.has("ArrowRight") || keys.has("KeyD") ? 1 : 0) || mobile.steer
      : 0;
    const brake = keys.has("Space") || mobile.brake;
    const manualRequested =
      active &&
      fuelAvailable() &&
      fuelPrediction.tank > 0 &&
      (keys.has("ShiftLeft") || keys.has("ShiftRight") || mobile.boost);
    const fuelStartX = car.position.x,
      fuelStartZ = car.position.z;
    boost = active && (manualRequested || elapsed < boostUntil);
    manualBoost = false;
    // A stationary car can still be nudged while its driver has a panel open.
    const pushed =
      !document.hidden &&
      !countdownLocked &&
      !arenaEliminated &&
      recovering === 0 &&
      Math.hypot(impactMotion.x, impactMotion.z) > 0.1;
    if (active || pushed) {
      const previousPosition = {
        x: car.position.x,
        y: jump,
        z: car.position.z,
      };
      if (throttle || steer || brake) cancelNavigation();
      let autopilot = waypoints.length > 0;
      if (autopilot) {
        let goal = waypoints[0],
          distance = Math.hypot(
            goal.x - car.position.x,
            goal.z - car.position.z,
          );
        if (distance < (waypoints.length === 1 ? 0.04 : 0.32)) {
          waypoints.shift();
          if (!waypoints.length) {
            cancelNavigation();
            speed = 0;
            autopilot = false;
          } else {
            goal = waypoints[0];
            distance = Math.hypot(
              goal.x - car.position.x,
              goal.z - car.position.z,
            );
          }
        }
        if (autopilot) {
          const desired = Math.atan2(
            goal.x - car.position.x,
            goal.z - car.position.z,
          );
          const turn = Math.atan2(
            Math.sin(desired - heading),
            Math.cos(desired - heading),
          );
          heading += turn * (1 - Math.exp(-10 * vehicle.grip * dt));
          steer = THREE.MathUtils.clamp(turn * 1.3, -1, 1);
          const desiredSpeed = inSoccer
            ? soccerNavigationSpeed(distance, turn, drivingVehicle, boost)
            : Math.min(
                (3.5 * (boost ? drivingVehicle.boostSpeed : vehicle.topSpeed)) /
                  6.8,
                (distance * 3.2 * vehicle.acceleration) / 9,
              ) * Math.max(0.1, Math.cos(turn));
          speed = THREE.MathUtils.lerp(
            speed,
            desiredSpeed,
            1 - Math.exp(((-8 * vehicle.acceleration) / 9) * dt),
          );
        }
      } else {
        speed = advanceDriveSpeed(
          speed,
          {
            throttle,
            brake,
            boost,
            boostedByPad: elapsed < boostUntil,
          },
          dt,
          drivingVehicle,
        );
        steeringInput = smoothSteering(steeringInput, steer, dt, vehicle);
        steer = steeringInput;
        const onRail =
          projectDuel(car.position.x, car.position.z).inside ||
          projectTrack(car.position.x, car.position.z).distance <=
            TRACK.halfWidth;
        heading +=
          steer * speed * (onRail ? 0.22 : 0.72) * vehicle.steering * dt;
      }
      heading += impactMotion.spin * dt;
      let vx = Math.sin(heading) * speed + impactMotion.x;
      let vz = Math.cos(heading) * speed + impactMotion.z;
      const velocityScale = Math.min(
        1,
        (inArena
          ? ARENA.maxSpeed - 2
          : inSoccer
            ? SOCCER.maxCarSpeed - 2
            : 22) / (Math.hypot(vx, vz) || 1),
      );
      car.position.x += vx * velocityScale * dt;
      car.position.z += vz * velocityScale * dt;
      if (!inSoccer && !inArena)
        for (const c of activeColliders) {
          const dx = car.position.x - c.x,
            dz = car.position.z - c.z,
            d = Math.hypot(dx, dz);
          if (d < c.r + 0.58 && d > 0.001) {
            const push = (c.r + 0.58 - d) / d;
            car.position.x += dx * push;
            car.position.z += dz * push;
            speed *= -0.22 * vehicle.bounce;
            debugCollisions++;
          }
        }
      if (Math.abs(speed) > 0.3) {
        driveTime += dt;
        if (!hasMoved) {
          hasMoved = true;
          callbacks.onMove?.();
        }
      }
      if (inArena) {
        const contact = arenaGuardContact(
          previousPosition,
          {
            x: car.position.x,
            y: Math.max(0, jump + (jumpVelocity - 12 * dt) * dt),
            z: car.position.z,
          },
          arena.radius,
          arena.guards,
        );
        if (contact) {
          car.position.x = contact.x;
          car.position.z = contact.z;
          const into = vx * contact.nx + vz * contact.nz;
          if (into < 0) {
            impactMotion.x = (vx - 1.45 * into * contact.nx) * 0.72;
            impactMotion.z = (vz - 1.45 * into * contact.nz) * 0.72;
            speed = 0;
            cancelNavigation();
          }
        }
        if (
          Math.hypot(car.position.x - ARENA.cx, car.position.z - ARENA.cz) >
          arena.radius + 0.7
        ) {
          arenaFellAt ??= elapsed;
          speed = 0;
          clearInput();
          clearImpact();
          cancelNavigation();
        }
      }
      if (inSoccer) {
        const contact = resolveSoccerWall({
          x: car.position.x,
          z: car.position.z,
          vx: vx * velocityScale,
          vz: vz * velocityScale,
          speed,
          heading,
          impactX: impactMotion.x,
          impactZ: impactMotion.z,
        });
        car.position.x = contact.x;
        car.position.z = contact.z;
        impactMotion.x = contact.impactX;
        impactMotion.z = contact.impactZ;
        if (contact.hit) cancelNavigation();
      }
      if (!inArena && !inSoccer) {
        for (const garage of occupiedGarages()) {
          const wall = garageWallContact(
            previousPosition,
            car.position,
            garage,
          );
          if (wall) {
            car.position.x = wall.x;
            car.position.z = wall.z;
            const into = vx * wall.nx + vz * wall.nz;
            clearImpact();
            if (into < 0) {
              impactMotion.x = wall.nx * Math.min(1.2, -into * 0.12);
              impactMotion.z = wall.nz * Math.min(1.2, -into * 0.12);
            }
            speed *= 0.15;
            cancelNavigation();
          }
          const contact = garageDoorContact(
            previousPosition,
            car.position,
            garage,
            localId,
            fuelNow(),
          );
          if (!contact) continue;
          car.position.x = contact.x;
          car.position.z = contact.z;
          speed = 0;
          clearImpact();
          cancelNavigation();
        }
      }
      if (
        !inArena &&
        !inSoccer &&
        !isDriveable(car.position.x, car.position.z) &&
        projectDuel(previousPosition.x, previousPosition.z).inside
      ) {
        // Keep lateral impacts on the track: slide along its curb, retaining
        // forward momentum instead of teleporting or trapping either driver.
        const course = projectDuel(car.position.x, car.position.z);
        const edge = duelPoint(
          course.progress,
          Math.sign(course.lateralOffset) * (DUEL_TRACK.halfWidth - 0.12),
        );
        car.position.x = edge.x;
        car.position.z = edge.z;
        const tx = Math.sin(course.heading),
          tz = Math.cos(course.heading);
        const along = impactMotion.x * tx + impactMotion.z * tz;
        impactMotion.x = tx * along;
        impactMotion.z = tz * along;
        heading +=
          Math.atan2(
            Math.sin(course.heading - heading),
            Math.cos(course.heading - heading),
          ) * 0.35;
        speed *= 0.85;
      }
      if (
        !inArena &&
        !inSoccer &&
        !worldDriveable(car.position.x, car.position.z)
      ) {
        // Return to the last valid point, at most one frame away. A brief
        // visual dip signals recovery without sending an invalid/teleport pose.
        car.position.x = previousPosition.x;
        car.position.z = previousPosition.z;
        heading = recoveryHeading(
          car.position.x,
          car.position.z,
          Math.sign(speed),
        );
        speed = 0;
        jump = 0;
        jumpVelocity = 0;
        boostUntil = 0;
        recovering = 0.65;
        clearImpact();
        cancelNavigation();
        callbacks.onRecovery?.();
      }
      const railBumper =
        !inSoccer && !inArena && jump < 0.4
          ? railway.hitBumper(car.position, speed, elapsed)
          : null;
      if (railBumper) {
        railway.playBumper(railBumper.id, elapsed);
        cancelNavigation();
        const towardRail = car.position.z < 28.5 ? 0 : Math.PI / 2;
        heading = towardRail + (Math.random() - 0.5) * 1.05;
        ({ speed, jumpVelocity } = obstacleResponse(
          4 + Math.random() * 3,
          2.2 + Math.random() * 1.3,
          vehicle,
        ));
        boostUntil = elapsed + 0.25;
      }
      const attraction =
        !inSoccer && !inArena && jump < 0.45
          ? attractions.hit(
              { x: car.position.x, z: car.position.z },
              speed,
              elapsed,
            )
          : null;
      if (attraction) {
        attractions.play(attraction.id, elapsed);
        callbacks.onInteraction?.({
          objectId: attraction.id,
          kind: attraction.kind,
        });
        if (attraction.kind === "boost") {
          speed = (speed < 0 ? -1 : 1) * vehicle.boostSpeed;
          boostUntil = elapsed + 2.5;
        }
        if (attraction.kind === "jump") {
          jumpVelocity = 8.8;
        }
        if (attraction.kind === "pop") {
          speed *= 0.6;
          jumpVelocity = 2.4;
        }
        if (attraction.kind === "bounce") {
          cancelNavigation();
          heading = Math.atan2(
            car.position.x - attraction.x,
            car.position.z - attraction.z,
          );
          ({ speed, jumpVelocity } = obstacleResponse(10, 3.5, vehicle));
          boostUntil = elapsed + 0.7;
        }
      }
      const duelObstacle =
        !inSoccer && !inArena
          ? duelWorld.hit(
              { x: car.position.x, y: jump, z: car.position.z },
              speed,
              elapsed,
            )
          : null;
      if (duelObstacle) {
        duelWorld.play(duelObstacle.id, elapsed);
        callbacks.onInteraction?.({
          objectId: duelObstacle.id,
          kind: duelObstacle.kind,
        });
        const rules = DUEL_OBSTACLE_RULES[duelObstacle.kind];
        jumpVelocity = rules.jumpVelocity;
        if (duelObstacle.kind === "bounce") {
          cancelNavigation();
          const course = projectDuel(car.position.x, car.position.z);
          const direction =
            Math.sign(course.lateralOffset) ||
            (duelObstacle.lane === 0 ? -1 : 1);
          heading = course.heading + direction * 0.45;
          ({ speed, jumpVelocity } = obstacleResponse(
            rules.speed,
            rules.jumpVelocity,
            vehicle,
          ));
          boostUntil = elapsed + 0.45;
        }
        if (duelObstacle.kind === "boost") {
          cancelNavigation();
          speed = (speed < 0 ? -1 : 1) * rules.speed;
          boostUntil = elapsed + rules.duration;
          raceBoostUntil = boostUntil;
        }
      }
      const arenaObstacle =
        inArena && arenaFellAt === null
          ? arenaWorld.hit(
              { x: car.position.x, y: jump, z: car.position.z },
              speed,
              elapsed,
            )
          : null;
      if (arenaObstacle) {
        arenaWorld.play(arenaObstacle.id, elapsed);
        callbacks.onInteraction?.({
          objectId: arenaObstacle.id,
          kind: arenaObstacle.kind,
        });
        const rules = ARENA_OBSTACLE_RULES[arenaObstacle.kind];
        if (arenaObstacle.kind === "jump") jumpVelocity = rules.jumpVelocity;
        if (arenaObstacle.kind === "boost") {
          cancelNavigation();
          speed = (speed < 0 ? -1 : 1) * rules.speed;
          boostUntil = elapsed + rules.duration;
          raceBoostUntil = boostUntil;
          impactMotion.x += Math.sin(heading) * 5;
          impactMotion.z += Math.cos(heading) * 5;
        }
        if (arenaObstacle.kind === "bounce") {
          cancelNavigation();
          const away = Math.atan2(
            car.position.x - arenaObstacle.x,
            car.position.z - arenaObstacle.z,
          );
          impactMotion.x = Math.sin(away) * rules.kick * vehicle.bounce;
          impactMotion.z = Math.cos(away) * rules.kick * vehicle.bounce;
          jumpVelocity = rules.jumpVelocity;
          speed *= 0.3;
        }
      }
      const onTrampoline =
        Math.hypot(car.position.x - 8.1, car.position.z - 4) < 1.1;
      if (!inSoccer && !inArena && onTrampoline && jump === 0) jumpVelocity = 5;
      if (Math.abs(speed) > 2 && elapsed % 0.1 < dt) {
        const p = dust[dustIndex++ % dust.length];
        p.life = 1;
        p.m.position.set(
          car.position.x - Math.sin(heading),
          0.12,
          car.position.z - Math.cos(heading),
        );
        p.m.visible = true;
      }
    } else speed *= Math.exp(-8 * dt);
    manualBoost = fuelPrediction.consume(
      dt,
      fuelPlayer()?.consumptionRate ||
        getFuelEconomy(equipped.body).consumptionRate,
      manualRequested,
      Math.hypot(car.position.x - fuelStartX, car.position.z - fuelStartZ) >
        dt * 0.12,
    );
    if (stealHeld) {
      const nearby = fuelContext().nearTheft;
      if (
        fuelLocked() ||
        !nearby ||
        nearby.ownerId !== stealTarget ||
        nearby.closed ||
        fuelPlayer()?.carrying
      )
        void setFuelStealHeld(false);
    }
    if (!document.hidden) {
      jumpVelocity -= 12 * dt;
      jump = Math.max(0, jump + jumpVelocity * dt);
      if (jump === 0) jumpVelocity = 0;
    }
    const impactDrag = inArena ? 1.5 : inSoccer ? SOCCER_IMPACT_DRAG : 2.4;
    impactMotion.x *= Math.exp(-impactDrag * vehicle.grip * dt);
    impactMotion.z *= Math.exp(-impactDrag * vehicle.grip * dt);
    impactMotion.spin *= Math.exp(-3.2 * vehicle.grip * dt);
    impactMotion.roll *= Math.exp(-5 * dt);
    attractions.update(dt, elapsed);
    railway.update(dt, elapsed);
    duelWorld.update(dt, elapsed);
    arenaWorld.update(dt, elapsed);
    arenaCelebration.update(dt, elapsed);
    soccerWorld.update(dt, elapsed);
    destinationMarker.scale.setScalar(
      reduced ? 1 : 1 + Math.sin(elapsed * 4) * 0.12,
    );
    car.position.y = jump;
    car.rotation.y = heading;
    const fallAge =
      arenaFellAt === null ? 0 : Math.max(0, elapsed - arenaFellAt);
    car.visible = arenaFellAt === null || fallAge < 1.1;
    carVisual.position.y =
      arenaFellAt !== null
        ? -Math.min(12, fallAge * fallAge * 12)
        : recovering > 0
          ? -Math.sin((1 - recovering / 0.65) * Math.PI) * 1.05
          : 0;
    cosmeticEffects.trail(car, speed, dt, elapsed);
    carBody.rotation.z = THREE.MathUtils.lerp(
      carBody.rotation.z,
      (steer * speed * 0.015) / vehicle.grip +
        (reduced ? 0 : impactMotion.roll),
      0.1,
    );
    carBody.position.y = reduced
      ? 0
      : Math.sin(elapsed * 18) * Math.abs(speed) * 0.003 * vehicle.bounce;
    wheels.forEach((w) => {
      w.pivot.rotation.y = w.front ? steer * 0.3 : 0;
      w.tire.rotation.x += speed * dt * 2;
      w.hub.rotation.x += speed * dt * 2;
    });
    if (!reduced) {
      blades.rotation.z = elapsed * 0.32;
      balls.forEach(
        (b, i) => (b.position.y = 0.5 + Math.sin(elapsed * 1.3 + i) * 0.08),
      );
      pennant.rotation.y = Math.sin(elapsed * 3) * 0.15;
    }
    dust.forEach((p) => {
      if (p.life > 0) {
        p.life -= dt * 1.4;
        p.m.material.opacity = p.life * 0.28;
        p.m.position.y += dt * 0.2;
        p.m.scale.setScalar(1 + (1 - p.life) * 2);
        if (p.life <= 0) p.m.visible = false;
      }
    });
    const aspect = width / height;
    const railFocus = THREE.MathUtils.smoothstep(car.position.z, 11, 27);
    const duelProjection = projectDuel(car.position.x, car.position.z);
    const onDuel = duelProjection.inside;
    target.lerp(
      arenaView
        ? new THREE.Vector3(ARENA.cx, 0, ARENA.cz)
        : soccerView
          ? new THREE.Vector3(SOCCER.cx, 0, SOCCER.cz)
          : onDuel
            ? new THREE.Vector3(
                car.position.x + Math.sin(duelProjection.heading) * 4,
                0,
                car.position.z + Math.cos(duelProjection.heading) * 4,
              )
            : new THREE.Vector3(
                HOME_FOCUS.x * (1 - railFocus * 0.65) +
                  car.position.x * (0.22 + railFocus * 0.5),
                HOME_FOCUS.y * (1 - railFocus),
                car.position.z * (0.2 + railFocus * 0.63) +
                  HOME_FOCUS.z * (1 - railFocus),
              ),
      1 - Math.exp(-2 * dt),
    );
    camera.position.copy(target).add(cameraOffset);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    if (audioContext && osc) {
      osc.frequency.setTargetAtTime(
        55 + Math.abs(speed) * 14,
        audioContext.currentTime,
        0.15,
      );
      gain.gain.setTargetAtTime(
        sound && active ? 0.012 + Math.abs(speed) * 0.002 : 0,
        audioContext.currentTime,
        0.1,
      );
    }
    for (const p of remoteCars.values()) {
      const member = (arenaLive(arena) ? arena : arenaDisplay)?.players?.find(
        (entry) => entry.id === p.id,
      );
      if (member?.alive === false && !remoteFalls.has(p.id))
        remoteFalls.set(p.id, elapsed);
      if (member?.alive !== false) remoteFalls.delete(p.id);
      const remoteFall = remoteFalls.has(p.id)
        ? Math.max(0, elapsed - remoteFalls.get(p.id))
        : null;
      p.model.visible = remoteFall === null || remoteFall < 1.1;
      p.model.getObjectByName("car-visual").position.y =
        remoteFall === null ? 0 : -Math.min(12, remoteFall * remoteFall * 12);
      const previousX = p.model.position.x,
        previousZ = p.model.position.z;
      const teleported = Math.hypot(p.x - previousX, p.z - previousZ) > 10;
      p.model.position.lerp(
        new THREE.Vector3(p.x, p.y || 0, p.z),
        teleported ? 1 : 1 - Math.exp(-13 * dt),
      );
      const delta = Math.atan2(
        Math.sin(p.heading - p.model.rotation.y),
        Math.cos(p.heading - p.model.rotation.y),
      );
      p.model.rotation.y += delta * (1 - Math.exp(-13 * dt));
      const remoteSpeed =
        Math.hypot(
          p.model.position.x - previousX,
          p.model.position.z - previousZ,
        ) / Math.max(dt, 0.001);
      if (!teleported) cosmeticEffects.trail(p.model, remoteSpeed, dt, elapsed);
    }
    updateSoccerTeams();
    fuelCars.clear();
    if (localId) fuelCars.set(localId, car);
    for (const peer of remoteCars.values()) fuelCars.set(peer.id, peer.model);
    fuelWorld.update(fuelNow(), fuelCars, lighting.night);
    cosmeticEffects.update(dt, elapsed);
    nightLights.update(lighting.night, elapsed);
    postProcessing.render(dt);
    near =
      ZONES.find(
        (zone) =>
          Math.hypot(car.position.x - zone.x, car.position.z - zone.z) < 3.8,
      )?.id ?? null;
    const snapshot = {
      x: car.position.x,
      y: car.position.y,
      z: car.position.z,
      speed: Math.round(Math.abs(speed) * 5),
      heading,
      near,
      driveTime,
      boost: elapsed < boostUntil,
      manualBoost,
      fuel: {
        tank: fuelPrediction.tank,
        manualBoost,
        ...fuelContext(),
        stealHeld,
        stealProgress: stealHeld
          ? THREE.MathUtils.clamp(
              (fuelNow() -
                (fuelPlayer()?.stealing?.startedAt || stealBeganAt)) /
                FUEL.stealMs,
              0,
              1,
            )
          : 0,
        carried: fuelPlayer()?.carrying || null,
      },
      navigating: waypoints.length > 0,
      track: {
        progress: projectTrack(car.position.x, car.position.z).progress,
        onTrack:
          projectTrack(car.position.x, car.position.z).distance <=
          TRACK.halfWidth,
      },
      raceLocked: countdownLocked,
      arenaMarker: project(ARENA.cx, 2.8, ARENA.cz),
      arenaSpectating: arenaPeek && !inArena,
      soccerMarker: project(SOCCER.cx, 3, SOCCER.cz),
      soccerSpectating: soccerPeek && !inSoccer,
      lighting,
      labels: ZONES.map((zone) => ({
        ...zone,
        ...project(zone.x, 3.9, zone.z),
      })),
      peers: [...remoteCars.values()]
        .filter((p) => p.model.visible)
        .map((p) => ({
          id: p.id,
          nickname: p.nickname,
          color: p.color,
          ...project(
            p.model.position.x,
            2.1 + p.model.position.y,
            p.model.position.z,
          ),
        })),
      car: car.visible
        ? project(car.position.x, 1.9 + jump, car.position.z)
        : null,
    };
    // Project DOM photos from the same camera and interpolated poses as this frame.
    callbacks.onRender?.(snapshot);
    if (time - lastUi > 60) {
      lastUi = time;
      callbacks.onFrame(snapshot);
    }
  }
  frameId = requestAnimationFrame(step);
  return {
    reset,
    setFuel(value) {
      fuel = value || null;
      if (Number.isFinite(value?.serverAt))
        fuelClockOffset = Date.now() - value.serverAt;
      fuelPrediction.reconcile(fuelPlayer(), value?.serverAt);
      if (!fuelAvailable() && (stealHeld || stealTarget))
        void setFuelStealHeld(false);
      if (stealHeld) {
        if (fuelPlayer()?.stealing?.targetId === stealTarget)
          sawServerStealing = true;
        else if (sawServerStealing) void setFuelStealHeld(false);
      }
      refreshFuel();
    },
    setFuelStealHeld,
    driveToGarage,
    setTimeControl(value) {
      lightingClock.set(value, (performance.now() - openedAt) / 1000);
    },
    setPaused(value) {
      paused = value;
      clearInput();
    },
    setMobile(value) {
      mobile = { ...mobile, ...value };
      if (Object.values(value).some(Boolean)) {
        cancelNavigation();
        leaveSpectatorView();
      }
    },
    setSound: soundOn,
    setPeers: updatePeers,
    setCosmetics(value) {
      applyCarCosmetics(car, soloEquipment(value), localColor);
      equipped = { ...car.userData.cosmetics };
    },
    applySpray(event) {
      return cosmeticEffects.spray(event, elapsed);
    },
    setRace(value) {
      race = value || null;
      if (
        race &&
        (arenaPeek || soccerPeek) &&
        localId &&
        (race.hostId === localId || race.guestId === localId)
      )
        leaveSpectatorView();
      duelWorld.setRace(race, localId);
      if (
        race?.status === "countdown" &&
        (race.hostId === localId || race.guestId === localId)
      ) {
        cancelNavigation();
        clearInput();
        speed = 0;
      }
    },
    setArena(value) {
      const newMatch = value?.id !== arena?.id;
      const launching =
        value?.status === "countdown" && arena?.status !== "countdown";
      arena = value || null;
      if (insideArena()) soccerPeek = false;
      if (newMatch || launching || !arenaLive(arena)) {
        arenaFellAt = null;
        car.visible = true;
        carVisual.position.y = 0;
        if (launching) {
          arenaPeek = false;
          recovering = 0;
          speed = jump = jumpVelocity = boostUntil = 0;
          clearInput();
          clearImpact();
          cancelNavigation();
        }
      }
      if (insideArena() && arenaMember()?.alive === false) {
        arenaFellAt ??= elapsed;
        clearInput();
        clearImpact();
        cancelNavigation();
        speed = 0;
      }
      refreshArena();
    },
    setArenaDisplay(value) {
      arenaDisplay = value || null;
      refreshArena();
    },
    celebrateArena(kind, eventKey) {
      arenaCelebration.celebrate(kind, eventKey);
    },
    setArenaSpectating,
    setSoccer(value) {
      const newMatch = value?.id !== soccer?.id;
      const changed =
        value?.id !== soccer?.id ||
        value?.status !== soccer?.status ||
        value?.sequence !== soccer?.sequence;
      soccer = value || null;
      if (newMatch || !soccerMember()) soccerTransfer = null;
      else if (soccerLive(soccer) && soccerTransfer === "entering")
        soccerTransfer = null;
      if (insideSoccer()) {
        arenaPeek = soccerPeek = false;
        if (changed) {
          arenaFellAt = null;
          car.visible = true;
          carVisual.position.y = 0;
          recovering = 0;
          speed = jump = jumpVelocity = boostUntil = raceBoostUntil = 0;
          clearInput();
          clearImpact();
          cancelNavigation();
        }
      }
      refreshSoccer();
    },
    setSoccerDisplay(value) {
      soccerDisplay = value || null;
      refreshSoccer();
    },
    setSoccerSpectating,
    rewardLap() {
      railway.reward(elapsed);
    },
    driveTo,
    applyInteraction(event) {
      if (event.type === "car:impact") {
        if (seenImpacts.has(event.id)) return;
        seenImpacts.add(event.id);
        if (seenImpacts.size > 64)
          seenImpacts.delete(seenImpacts.values().next().value);
        const push = event.participants?.find((p) => p.id === localId);
        const soccerImpact =
          insideSoccer() &&
          soccer.status === "playing" &&
          event.soccerId === soccer.id;
        if (
          push &&
          (insideSoccer() || event.soccerId ? soccerImpact : true) &&
          !(
            insideArena() &&
            (arenaFellAt !== null || arenaMember()?.alive === false)
          ) &&
          [push.vx, push.vz, push.spin].every(Number.isFinite)
        ) {
          cancelNavigation();
          if (soccerImpact) {
            const response = applySoccerCarImpulse(
              {
                speed,
                heading,
                impactX: impactMotion.x,
                impactZ: impactMotion.z,
              },
              push,
            );
            speed = response.speed;
            impactMotion.x = response.impactX;
            impactMotion.z = response.impactZ;
          } else {
            const maxPush = insideArena() ? 32 : 16;
            impactMotion.x = THREE.MathUtils.clamp(
              impactMotion.x + push.vx,
              -maxPush,
              maxPush,
            );
            impactMotion.z = THREE.MathUtils.clamp(
              impactMotion.z + push.vz,
              -maxPush,
              maxPush,
            );
            // Preserve the established everyday and colosseum responses.
            const along =
              Math.sin(heading) * push.vx + Math.cos(heading) * push.vz;
            if (!insideArena() && speed * along < 0)
              speed =
                Math.sign(speed) *
                Math.min(Math.abs(speed) * 0.18, Math.abs(along) * 0.35);
          }
          impactMotion.spin = push.spin;
          impactMotion.roll = push.spin * 0.14;
          if (jump < 0.15)
            jumpVelocity = Math.max(jumpVelocity, 1.5 + event.strength);
        }
        for (let i = 0; i < 8; i++) {
          const p = dust[dustIndex++ % dust.length];
          p.life = 1;
          p.m.position.set(
            event.x + Math.sin((i * Math.PI) / 4) * 0.7,
            0.12,
            event.z + Math.cos((i * Math.PI) / 4) * 0.7,
          );
          p.m.visible = true;
        }
        return;
      }
      if (event.arenaId) {
        arenaWorld.play(event.objectId, elapsed, true, event.arenaId);
        return;
      }
      if (event.raceId) {
        duelWorld.play(event.objectId, elapsed, true, event.raceId);
        return;
      }
      attractions.play(event.objectId, elapsed, true);
    },
    setIdentity(player) {
      if (stealHeld || stealTarget) void setFuelStealHeld(false);
      clearImpact();
      soccerTransfer = null;
      arenaFellAt = null;
      car.visible = true;
      if (player) {
        localId = player.id;
        localColor = player.color;
        cancelNavigation();
        car.position.set(player.x, 0, player.z);
        jump = 0;
        jumpVelocity = 0;
        boostUntil = 0;
        recovering = 0;
        heading = player.heading;
        speed = 0;
        applyCarCosmetics(
          car,
          player.cosmetics || STARTER_EQUIPPED,
          localColor,
        );
        equipped = { ...car.userData.cosmetics };
      } else {
        localId = null;
        localColor = "#a5bf90";
        applyCarCosmetics(car, soloEquipment(equipped), localColor);
        equipped = { ...car.userData.cosmetics };
      }
      duelWorld.setRace(race, localId);
      refreshArena();
      refreshSoccer();
      fuelPrediction.reconcile(fuelPlayer(), fuel?.serverAt);
      refreshFuel();
    },
    setPosition(player) {
      clearImpact();
      arenaFellAt = null;
      car.visible = true;
      carVisual.position.y = 0;
      if (soccerMember()) {
        // Teleport and match-state packets can land in separate browser frames.
        // Honor the authoritative pose immediately, before applying pitch bounds.
        soccerTransfer = soccerPoseTransfer(
          soccer,
          localId,
          player,
          soccerTransfer,
        );
      }
      const changedCourse =
        projectDuel(car.position.x, car.position.z).inside !==
        projectDuel(player.x, player.z).inside;
      cancelNavigation();
      jump = player.y || 0;
      jumpVelocity = 0;
      boostUntil = 0;
      recovering = 0;
      car.position.set(player.x, jump, player.z);
      heading = player.heading;
      speed = 0;
      clearInput();
      refreshViews();
      if (changedCourse) {
        target.set(
          player.x - 3,
          0,
          projectDuel(player.x, player.z).inside
            ? player.z - 3
            : player.z * 0.6,
        );
      }
    },
    goTo(id) {
      if (id === "arena") {
        setArenaSpectating(true);
        return;
      }
      if (id === "soccer") {
        setSoccerSpectating(true);
        return;
      }
      if (insideArena() || insideSoccer()) return;
      leaveSpectatorView();
      clearImpact();
      cancelNavigation();
      const zone = ZONES.find((z) => z.id === id);
      if (!zone && id !== "track") return;
      const destination =
        id === "track"
          ? trackPoint(0)
          : { x: zone.x, z: zone.z + 3.3, heading: Math.PI };
      car.position.set(destination.x, 0, destination.z);
      jump = 0;
      jumpVelocity = 0;
      boostUntil = 0;
      recovering = 0;
      heading = destination.heading;
      speed = 0;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frameId);
      ro.disconnect();
      for (const layer of clippedWorldLayers)
        layer.style.removeProperty("--world-content-clip");
      worldLabels?.style.removeProperty("--place-label-scale");
      renderer.domElement.removeEventListener("wheel", wheelZoom);
      interactionSurface.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", stopInput);
      document.removeEventListener("visibilitychange", stopInput);
      audioContext?.close();
      cosmeticEffects.dispose();
      arenaWorld.dispose?.();
      arenaCelebration.dispose();
      soccerWorld.dispose();
      fuelWorld.dispose();
      nightLights.dispose();
      postProcessing.dispose();
      const textures = new Set(),
        geometries = new Set(),
        mats = new Set();
      scene.traverse((o) => {
        if (o.geometry) geometries.add(o.geometry);
        if (o.material) {
          for (const m of Array.isArray(o.material)
            ? o.material
            : [o.material]) {
            mats.add(m);
            if (m.map) textures.add(m.map);
          }
        }
      });
      geometries.forEach((g) => g.dispose());
      textures.forEach((t) => t.dispose());
      mats.forEach((m) => m.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
