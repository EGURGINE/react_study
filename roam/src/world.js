import * as THREE from "three";
import { findPath } from "./navigation.js";
import { createAttractions } from "./attractions.js";

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
    title: "작은 쉼터",
    subtitle: "아무 이야기나 좋아요",
    x: -8,
    z: -1,
    color: "#dba68b",
  },
  {
    id: "play",
    title: "같이 놀자",
    subtitle: "가벼운 딴짓도 좋아요",
    x: 8,
    z: 4,
    color: "#b7ba90",
  },
];
const START = { x: 1.3, z: 7.8, heading: -Math.PI / 2.4 };

export function createWorld(host, callbacks) {
  const scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
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
  const target = new THREE.Vector3(-3.4, 0, 0);
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
  scene.add(new THREE.AmbientLight(0xfff5e3, 1.4));
  const sun = new THREE.DirectionalLight(0xfff7dc, 3.2);
  sun.position.set(-15, 28, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -24,
    right: 24,
    top: 24,
    bottom: -24,
    near: 0.5,
    far: 80,
  });
  sun.shadow.normalBias = 0.03;
  sun.shadow.bias = -0.0001;
  sun.shadow.radius = 5;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xc8e8ec, 0xc8a678, 1.1));

  // Everything is real geometry: a little model you can drive around.
  cylinder(22.2, 21.6, 1.3, "#d6c39c", scene, 0, -0.82, 0, 96);
  cylinder(22.2, 22.2, 0.32, "#e8dbbc", scene, 0, -0.18, 0, 96);
  const backdrop = mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.ShadowMaterial({ opacity: 0.105 }),
    scene,
    0,
    -1.51,
    0,
  );
  backdrop.rotation.x = -Math.PI / 2;
  backdrop.castShadow = false;
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
    colliders.push({ x, z, r: 0.5 * s });
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
  const bodyMeshes = [];
  car.traverse((o) => {
    if (
      o.isMesh &&
      ["91ae80", "abc692", "aac98c", "bfd1a2", "cfdbac"].includes(
        o.material.color?.getHexString(),
      )
    ) {
      o.userData.isBody = true;
      o.material = o.material.clone();
      bodyMeshes.push(o);
    }
  });
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
        scene.add(model);
        p = { model, ownedMaterials, ...peer };
        remoteCars.set(peer.id, p);
      } else Object.assign(p, peer);
    }
  }
  const keys = new Set();
  let speed = 0,
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
  const attractions = createAttractions(scene);
  let boostUntil = 0;
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
    if (paused || disposed) return;
    renderer.domElement.focus({ preventScroll: true });
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      (-(event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    if (
      !raycaster.ray.intersectPlane(ground, hit) ||
      Math.hypot(hit.x, hit.z) > 22.5
    )
      return;
    driveTo({ x: hit.x, z: hit.z });
  }
  function driveTo(destination) {
    const path = findPath(
      { x: car.position.x, z: car.position.z },
      destination,
      colliders,
      { radius: 21.2, clearance: 0.82, step: 0.55 },
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
  let mobile = { throttle: 0, steer: 0, brake: false };
  let audioContext = null,
    osc = null,
    gain = null,
    sound = false;
  let disposed = false;
  let debugCollisions = 0;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const vec = new THREE.Vector3();
  let width = 1,
    height = 1;
  let zoom = 1;
  function resize() {
    width = host.clientWidth;
    height = host.clientHeight;
    renderer.setSize(width, height);
    const aspect = width / height;
    const size = (aspect < 1.2 ? 58 / aspect : 36) * zoom;
    camera.left = (-size * aspect) / 2;
    camera.right = (size * aspect) / 2;
    camera.top = size / 2;
    camera.bottom = -size / 2;
    camera.updateProjectionMatrix();
  }
  function wheelZoom(e) {
    e.preventDefault();
    zoom = THREE.MathUtils.clamp(zoom + e.deltaY * 0.0007, 0.65, 1.4);
    resize();
  }
  renderer.domElement.addEventListener("wheel", wheelZoom, { passive: false });
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();
  function clearInput() {
    keys.clear();
    mobile = { throttle: 0, steer: 0, brake: false };
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
      "Enter",
    ];
    if (accepted.includes(e.code)) {
      e.preventDefault();
      keys.add(e.code);
    }
    if (e.repeat) return;
    if (e.code === "KeyR") reset();
    if ((e.code === "KeyE" || e.code === "Enter") && near)
      callbacks.onInteract(near);
  }
  function keyup(e) {
    keys.delete(e.code);
  }
  window.addEventListener("keydown", keydown);
  window.addEventListener("keyup", keyup);
  window.addEventListener("blur", stopInput);
  document.addEventListener("visibilitychange", stopInput);
  function reset() {
    cancelNavigation();
    if (callbacks.onReset?.() === true) return;
    car.position.set(START.x, 0, START.z);
    heading = START.heading;
    speed = 0;
    jump = 0;
    jumpVelocity = 0;
    boostUntil = 0;
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
    const active = !paused && !document.hidden;
    let throttle = active
      ? (keys.has("ArrowUp") || keys.has("KeyW") ? 1 : 0) -
          (keys.has("ArrowDown") || keys.has("KeyS") ? 1 : 0) || mobile.throttle
      : 0;
    let steer = active
      ? (keys.has("ArrowLeft") || keys.has("KeyA") ? 1 : 0) -
          (keys.has("ArrowRight") || keys.has("KeyD") ? 1 : 0) || mobile.steer
      : 0;
    const brake = keys.has("Space") || mobile.brake;
    boost =
      active &&
      (keys.has("ShiftLeft") || keys.has("ShiftRight") || elapsed < boostUntil);
    if (active) {
      if (throttle || steer || brake) cancelNavigation();
      let autopilot = waypoints.length > 0;
      if (autopilot) {
        let goal = waypoints[0],
          distance = Math.hypot(
            goal.x - car.position.x,
            goal.z - car.position.z,
          );
        if (distance < 0.32) {
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
          heading += turn * (1 - Math.exp(-10 * dt));
          steer = THREE.MathUtils.clamp(turn * 1.3, -1, 1);
          const desiredSpeed =
            Math.min(3.5, distance * 3.2) * Math.max(0.1, Math.cos(turn));
          speed = THREE.MathUtils.lerp(
            speed,
            desiredSpeed,
            1 - Math.exp(-8 * dt),
          );
        }
      } else {
        speed += throttle * (boost ? 14 : 9) * dt;
        speed *= Math.exp(
          -(brake ? 9 : elapsed < boostUntil ? 0.3 : throttle ? 1.1 : 2.0) * dt,
        );
        speed = THREE.MathUtils.clamp(speed, -5, boost ? 13 : 6.8);
        if (Math.abs(speed) < 0.015) speed = 0;
        heading += steer * speed * 0.72 * dt;
      }
      car.position.x += Math.sin(heading) * speed * dt;
      car.position.z += Math.cos(heading) * speed * dt;
      const length = Math.hypot(car.position.x, car.position.z);
      if (length > 21.2) {
        car.position.x *= 21.2 / length;
        car.position.z *= 21.2 / length;
        speed *= -0.22;
      }
      for (const c of colliders) {
        const dx = car.position.x - c.x,
          dz = car.position.z - c.z,
          d = Math.hypot(dx, dz);
        if (d < c.r + 0.58 && d > 0.001) {
          const push = (c.r + 0.58 - d) / d;
          car.position.x += dx * push;
          car.position.z += dz * push;
          speed *= -0.22;
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
      for (const p of remoteCars.values()) {
        const dx = car.position.x - p.model.position.x,
          dz = car.position.z - p.model.position.z,
          d = Math.hypot(dx, dz);
        if (d < 1.18 && d > 0.01) {
          car.position.x += (dx / d) * (1.18 - d) * 0.6;
          car.position.z += (dz / d) * (1.18 - d) * 0.6;
          speed *= 0.93;
        }
      }
      const edge = Math.hypot(car.position.x, car.position.z);
      if (edge > 21.2) {
        car.position.x *= 21.2 / edge;
        car.position.z *= 21.2 / edge;
      }
      const attraction =
        jump < 0.45
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
          cancelNavigation();
          speed = speed < 0 ? -13 : 13;
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
          speed = 10;
          boostUntil = elapsed + 0.7;
          jumpVelocity = 3.5;
        }
      }
      const onTrampoline =
        Math.hypot(car.position.x - 8.1, car.position.z - 4) < 1.1;
      if (onTrampoline && jump === 0) jumpVelocity = 5;
      jumpVelocity -= 12 * dt;
      jump = Math.max(0, jump + jumpVelocity * dt);
      if (jump === 0) jumpVelocity = 0;
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
    attractions.update(dt, elapsed);
    destinationMarker.scale.setScalar(
      reduced ? 1 : 1 + Math.sin(elapsed * 4) * 0.12,
    );
    car.position.y = jump;
    car.rotation.y = heading;
    carBody.rotation.z = THREE.MathUtils.lerp(
      carBody.rotation.z,
      steer * speed * 0.015,
      0.1,
    );
    carBody.position.y = reduced
      ? 0
      : Math.sin(elapsed * 18) * Math.abs(speed) * 0.003;
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
    const tx = aspect < 0.8 ? -1 : -5.5;
    target.lerp(
      new THREE.Vector3(tx + car.position.x * 0.22, 0, car.position.z * 0.2),
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
      p.model.position.lerp(
        new THREE.Vector3(p.x, p.y || 0, p.z),
        1 - Math.exp(-13 * dt),
      );
      const delta = Math.atan2(
        Math.sin(p.heading - p.model.rotation.y),
        Math.cos(p.heading - p.model.rotation.y),
      );
      p.model.rotation.y += delta * (1 - Math.exp(-13 * dt));
    }
    renderer.render(scene, camera);
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
      navigating: waypoints.length > 0,
      labels: ZONES.map((zone) => ({
        ...zone,
        ...project(zone.x, 3.9, zone.z),
      })),
      peers: [...remoteCars.values()].map((p) => ({
        id: p.id,
        nickname: p.nickname,
        color: p.color,
        ...project(
          p.model.position.x,
          2.1 + p.model.position.y,
          p.model.position.z,
        ),
      })),
      car: project(car.position.x, 1.9 + jump, car.position.z),
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
    setPaused(value) {
      paused = value;
      clearInput();
    },
    setMobile(value) {
      mobile = { ...mobile, ...value };
      if (Object.values(value).some(Boolean)) cancelNavigation();
    },
    setSound: soundOn,
    setPeers: updatePeers,
    driveTo,
    applyInteraction(event) {
      attractions.play(event.objectId, elapsed, true);
    },
    setIdentity(player) {
      if (player) {
        cancelNavigation();
        car.position.set(player.x, 0, player.z);
        jump = 0;
        jumpVelocity = 0;
        boostUntil = 0;
        heading = player.heading;
        speed = 0;
        bodyMeshes.forEach((o) =>
          o.material.color
            .set(player.color)
            .lerp(new THREE.Color("#ffffff"), 0.16),
        );
      } else bodyMeshes.forEach((o) => o.material.color.set("#a5bf90"));
    },
    setPosition(player) {
      cancelNavigation();
      jump = player.y || 0;
      jumpVelocity = 0;
      boostUntil = 0;
      car.position.set(player.x, jump, player.z);
      heading = player.heading;
      speed = 0;
      clearInput();
    },
    goTo(id) {
      cancelNavigation();
      const zone = ZONES.find((z) => z.id === id);
      if (!zone) return;
      car.position.set(zone.x, 0, zone.z + 3.3);
      jump = 0;
      jumpVelocity = 0;
      boostUntil = 0;
      heading = Math.PI;
      speed = 0;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frameId);
      ro.disconnect();
      renderer.domElement.removeEventListener("wheel", wheelZoom);
      interactionSurface.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", stopInput);
      document.removeEventListener("visibilitychange", stopInput);
      audioContext?.close();
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
