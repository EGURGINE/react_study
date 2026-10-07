import * as THREE from "three";

export const ATTRACTIONS = Object.freeze(
  [
    { id: "pop-1", x: -15, z: 4, r: 0.9, kind: "pop" },
    { id: "pop-2", x: -16, z: 6, r: 0.9, kind: "pop" },
    { id: "pop-3", x: -14, z: 7, r: 0.9, kind: "pop" },
    { id: "boost-1", x: 16, z: 0, r: 1.2, kind: "boost" },
    { id: "boost-2", x: 12, z: 13, r: 1.2, kind: "boost" },
    { id: "bumper-1", x: -8, z: 16, r: 1, kind: "bounce" },
    { id: "bumper-2", x: -11, z: 14, r: 1, kind: "bounce" },
    { id: "jump-1", x: 14, z: 11, r: 1.3, kind: "jump" },
    { id: "jump-2", x: -16, z: -9, r: 1.3, kind: "jump" },
  ].map(Object.freeze),
);

const COOLDOWNS = { pop: 8, boost: 1.5, bounce: 1.2, jump: 1.8 };
const COLORS = {
  cream: "#f5e8cb",
  sand: "#d8c298",
  wood: "#99704e",
  bark: "#715a40",
  green: "#537459",
  sage: "#a9bd8a",
  lime: "#c4d676",
  coral: "#df937b",
  darkCoral: "#b96d59",
  blue: "#90b7c6",
  darkBlue: "#588b9b",
  yellow: "#e9c875",
};

/** Creates scene-owned scenery and visuals; the caller remains responsible for car physics. */
export function createAttractions(scene) {
  const materials = new Map();
  const records = new Map();
  const particleColors = [
    COLORS.coral,
    COLORS.lime,
    COLORS.yellow,
    COLORS.blue,
    COLORS.cream,
  ];
  const flameMeshes = [];
  const smoke = [];
  const bulbs = [];
  let night = 0;
  const root = new THREE.Group();
  root.name = "social-island-attractions";
  scene.add(root);

  function material(color, extra) {
    if (extra)
      return new THREE.MeshStandardMaterial({
        color,
        roughness: 0.84,
        ...extra,
      });
    if (!materials.has(color))
      materials.set(
        color,
        new THREE.MeshStandardMaterial({ color, roughness: 0.86 }),
      );
    return materials.get(color);
  }
  function mesh(geometry, color, parent, x = 0, y = 0, z = 0) {
    const result = new THREE.Mesh(
      geometry,
      typeof color === "string" ? material(color) : color,
    );
    result.position.set(x, y, z);
    result.castShadow = true;
    result.receiveShadow = true;
    parent.add(result);
    return result;
  }
  function box(w, h, d, color, parent, x = 0, y = 0, z = 0) {
    return mesh(new THREE.BoxGeometry(w, h, d), color, parent, x, y, z);
  }
  function cylinder(r1, r2, h, color, parent, x = 0, y = 0, z = 0, sides = 16) {
    return mesh(
      new THREE.CylinderGeometry(r1, r2, h, sides),
      color,
      parent,
      x,
      y,
      z,
    );
  }
  function group(parent, x = 0, y = 0, z = 0, rotation = 0) {
    const result = new THREE.Group();
    result.position.set(x, y, z);
    result.rotation.y = rotation;
    parent.add(result);
    return result;
  }
  function bar(from, to, radius, color, parent) {
    const first = new THREE.Vector3(...from);
    const last = new THREE.Vector3(...to);
    const direction = last.clone().sub(first);
    const result = cylinder(
      radius,
      radius,
      direction.length(),
      color,
      parent,
      0,
      0,
      0,
      6,
    );
    result.position.copy(first.add(last).multiplyScalar(0.5));
    result.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      direction.normalize(),
    );
    return result;
  }
  function spring(parent, x, z, height, radius) {
    const points = Array.from({ length: 49 }, (_, index) => {
      const t = index / 48;
      const angle = t * Math.PI * 6;
      return new THREE.Vector3(
        x + Math.cos(angle) * radius,
        0.17 + t * height,
        z + Math.sin(angle) * radius,
      );
    });
    return mesh(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(points),
        48,
        0.038,
        5,
        false,
      ),
      COLORS.green,
      parent,
    );
  }
  function flash(parent, color, radius) {
    const result = mesh(
      new THREE.TorusGeometry(radius, 0.055, 6, 36),
      material(color, {
        emissive: color,
        emissiveIntensity: 0.2,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
      parent,
      0,
      0.14,
      0,
    );
    result.rotation.x = -Math.PI / 2;
    result.castShadow = false;
    result.visible = false;
    return result;
  }
  function chevron(parent, y, z, color, size = 1) {
    const result = group(parent, 0, y, z);
    for (const side of [-1, 1]) {
      const stripe = box(
        0.15 * size,
        0.035,
        0.75 * size,
        color,
        result,
        side * 0.24 * size,
        0,
        0,
      );
      stripe.rotation.y = (-side * Math.PI) / 4;
    }
    return result;
  }

  for (const attraction of ATTRACTIONS) {
    const base = group(root, attraction.x, 0, attraction.z);
    base.name = attraction.id;
    const moving = group(base);
    const record = {
      attraction,
      base,
      moving,
      lastHit: -Infinity,
      lastVisual: -Infinity,
      flash: null,
      surface: null,
    };
    records.set(attraction.id, record);

    if (attraction.kind === "pop") {
      base.rotation.y = attraction.id === "pop-2" ? -0.24 : 0.13;
      cylinder(1, 1.05, 0.065, COLORS.sand, base, 0, 0.035, 0, 12);
      const colors =
        attraction.id === "pop-2"
          ? [COLORS.blue, COLORS.cream, COLORS.coral]
          : [COLORS.coral, COLORS.lime, COLORS.yellow];
      [
        [-0.32, 0.39, -0.23],
        [0.27, 0.39, 0.29],
        [-0.04, 1.04, 0],
      ].forEach(([x, y, z], index) => {
        const crate = group(moving, x, y, z, index === 2 ? -0.13 : 0);
        box(0.66, 0.64, 0.66, colors[index], crate);
        for (const side of [-1, 1]) {
          box(0.71, 0.07, 0.69, COLORS.cream, crate, 0, side * 0.22, 0);
          box(0.065, 0.64, 0.71, COLORS.cream, crate, side * 0.24, 0, 0);
        }
        const brace = box(0.075, 0.64, 0.025, COLORS.cream, crate, 0, 0, 0.345);
        brace.rotation.z = 0.7;
      });
      record.flash = flash(base, COLORS.yellow, 0.78);
    }

    if (attraction.kind === "boost") {
      base.rotation.y = attraction.id === "boost-1" ? 0 : Math.PI / 2;
      box(2.5, 0.1, 3.55, COLORS.green, base, 0, 0.055, 0);
      record.surface = material(COLORS.lime, {
        emissive: COLORS.lime,
        emissiveIntensity: 0.06,
      });
      box(2.23, 0.08, 3.33, record.surface, moving, 0, 0.14, 0);
      for (const side of [-1, 1]) {
        box(0.085, 0.07, 3.4, COLORS.cream, base, side * 1.18, 0.12, 0);
        for (const z of [-1.1, 0, 1.1])
          cylinder(
            0.065,
            0.065,
            0.06,
            COLORS.cream,
            base,
            side * 1.03,
            0.205,
            z,
            8,
          );
      }
      for (const z of [-1.04, 0, 1.04]) chevron(moving, 0.205, z, COLORS.green);
      record.flash = flash(base, COLORS.lime, 1.2);
    }

    if (attraction.kind === "bounce") {
      cylinder(1.02, 1.08, 0.18, COLORS.darkCoral, base, 0, 0.1, 0);
      spring(base, 0, 0, 0.52, 0.38);
      moving.position.y = 0.67;
      cylinder(0.89, 0.86, 0.32, COLORS.coral, moving, 0, 0, 0, 20);
      const ring = mesh(
        new THREE.TorusGeometry(0.71, 0.2, 8, 24),
        COLORS.coral,
        moving,
        0,
        0.16,
        0,
      );
      ring.rotation.x = Math.PI / 2;
      cylinder(0.49, 0.49, 0.035, COLORS.cream, moving, 0, 0.33, 0, 20);
      cylinder(0.26, 0.26, 0.045, COLORS.yellow, moving, 0, 0.355, 0, 12);
      record.flash = flash(base, COLORS.coral, 1);
    }

    if (attraction.kind === "jump") {
      cylinder(1.4, 1.46, 0.15, COLORS.cream, base, 0, 0.09, 0, 24);
      for (const x of [-0.67, 0.67])
        for (const z of [-0.67, 0.67]) spring(base, x, z, 0.42, 0.14);
      moving.position.y = 0.63;
      cylinder(1.24, 1.24, 0.16, COLORS.darkBlue, moving, 0, 0, 0, 24);
      record.surface = material(COLORS.blue, {
        emissive: COLORS.blue,
        emissiveIntensity: 0.03,
      });
      cylinder(1.13, 1.13, 0.045, record.surface, moving, 0, 0.1, 0, 24);
      const ring = mesh(
        new THREE.TorusGeometry(0.98, 0.045, 6, 32),
        COLORS.cream,
        moving,
        0,
        0.135,
        0,
      );
      ring.rotation.x = Math.PI / 2;
      chevron(moving, 0.14, -0.2, COLORS.cream, 1.15);
      chevron(moving, 0.14, 0.32, COLORS.cream, 1.15);
      record.flash = flash(base, COLORS.blue, 1.35);
    }
  }

  // Reusable confetti and wooden chips: multiplayer bursts never allocate new meshes.
  const particleGeometry = new THREE.BoxGeometry(0.18, 0.13, 0.26);
  const particles = Array.from({ length: 96 }, (_, index) => {
    const result = mesh(
      particleGeometry,
      particleColors[index % particleColors.length],
      root,
    );
    result.visible = false;
    return { mesh: result, vx: 0, vy: 0, vz: 0, spin: 0, life: 0, maxLife: 1 };
  });
  let particleCursor = 0;
  function burst(attraction, amount, strength) {
    for (let index = 0; index < amount; index++) {
      const particle = particles[particleCursor++ % particles.length];
      const angle = (index / amount) * Math.PI * 2 + Math.random() * 0.45;
      const outward = strength * (0.5 + Math.random() * 0.8);
      particle.mesh.position.set(
        attraction.x + Math.cos(angle) * 0.25,
        0.6 + Math.random() * 0.45,
        attraction.z + Math.sin(angle) * 0.25,
      );
      particle.mesh.rotation.set(
        Math.random() * 3,
        Math.random() * 3,
        Math.random() * 3,
      );
      particle.mesh.scale.setScalar(0.7 + Math.random() * 0.8);
      particle.mesh.visible = true;
      particle.vx = Math.cos(angle) * outward;
      particle.vz = Math.sin(angle) * outward;
      particle.vy = 2.5 + Math.random() * strength;
      particle.spin = (Math.random() - 0.5) * 11;
      particle.life = 1.2 + Math.random() * 0.5;
      particle.maxLife = particle.life;
    }
  }

  // A little campsite opens toward the island center, leaving room to park together.
  const camp = group(root, -2, 0, -16);
  camp.name = "campfire-hangout";
  const clearing = cylinder(
    4.8,
    4.8,
    0.026,
    "#c8c79a",
    camp,
    0,
    0.018,
    0.55,
    40,
  );
  clearing.scale.z = 0.86;
  const rug = box(3.3, 0.04, 2.15, COLORS.coral, camp, 0.8, 0.057, 2.55);
  rug.rotation.y = -0.12;
  for (const z of [-0.81, 0.81])
    box(3.12, 0.012, 0.09, COLORS.cream, rug, 0, 0.025, z);
  for (const x of [-1.25, -0.63, 0, 0.63, 1.25]) {
    const stitch = box(0.24, 0.015, 0.24, COLORS.yellow, rug, x, 0.025, 0);
    stitch.rotation.y = Math.PI / 4;
  }
  for (let index = 0; index < 9; index++) {
    const angle = (index / 9) * Math.PI * 2;
    const stone = mesh(
      new THREE.DodecahedronGeometry(0.23, 0),
      index % 2 ? "#a7ad93" : "#d4ccb3",
      camp,
      Math.cos(angle) * 0.83,
      0.14,
      0.55 + Math.sin(angle) * 0.83,
    );
    stone.scale.set(1.15, 0.7, 0.85);
  }
  const fire = group(camp, 0, 0, 0.55);
  for (let index = 0; index < 3; index++) {
    const log = cylinder(0.14, 0.15, 1.1, COLORS.bark, fire, 0, 0.2, 0, 8);
    log.rotation.z = Math.PI / 2;
    log.rotation.y = (index * Math.PI) / 3;
  }
  [
    [0, 0.78, 0, 0.38, 1.13, "#eabf69"],
    [-0.2, 0.55, 0.14, 0.24, 0.8, "#e69a69"],
    [0.2, 0.49, -0.12, 0.22, 0.69, "#f4d78e"],
  ].forEach(([x, y, z, radius, height, color], index) => {
    const flame = mesh(
      new THREE.ConeGeometry(radius, height, 5),
      material(color, { emissive: color, emissiveIntensity: 0.38 }),
      fire,
      x,
      y,
      z,
    );
    flame.castShadow = false;
    flameMeshes.push({ mesh: flame, y, phase: index * 2.3 });
  });
  const fireLight = new THREE.PointLight("#ffc578", 1.3, 5, 2);
  fireLight.castShadow = false;
  fireLight.position.set(0, 1.1, 0.55);
  camp.add(fireLight);
  const smokeMaterial = material("#e8e2cb", {
    transparent: true,
    opacity: 0.25,
    depthWrite: false,
  });
  const smokeGeometry = new THREE.IcosahedronGeometry(0.17, 0);
  for (let index = 0; index < 5; index++) {
    const puff = mesh(smokeGeometry, smokeMaterial, fire);
    puff.castShadow = false;
    smoke.push({ mesh: puff, phase: index / 5 });
  }

  function logSeat(x, z, angle) {
    const seat = group(camp, x, 0, z, angle);
    cylinder(0.27, 0.27, 1.75, COLORS.wood, seat, 0, 0.36, 0, 10).rotation.z =
      Math.PI / 2;
    for (const side of [-1, 1]) {
      cylinder(
        0.23,
        0.23,
        0.015,
        COLORS.sand,
        seat,
        side * 0.885,
        0.36,
        0,
        10,
      ).rotation.z = Math.PI / 2;
      box(0.15, 0.2, 0.49, COLORS.bark, seat, side * 0.54, 0.11, 0);
    }
  }
  logSeat(-1.95, 0.45, Math.PI / 2 + 0.14);
  logSeat(1.95, 0.15, Math.PI / 2 - 0.17);
  logSeat(-0.15, -1.4, -0.08);
  for (const [x, z, color] of [
    [-0.1, 2.55, COLORS.cream],
    [1.45, 2.9, COLORS.sage],
    [2.25, 2.15, COLORS.yellow],
  ]) {
    const cushion = box(0.67, 0.25, 0.65, color, camp, x, 0.22, z);
    cushion.rotation.y = x * 0.23;
    cylinder(0.05, 0.05, 0.015, COLORS.sand, cushion, 0, 0.133, 0, 8);
  }
  const table = group(camp, -1.75, 0, 2.7, 0.15);
  box(0.91, 0.12, 0.71, COLORS.sand, table, 0, 0.54, 0);
  for (const x of [-0.32, 0.32])
    box(0.1, 0.5, 0.54, COLORS.wood, table, x, 0.25, 0);
  for (const [x, z] of [
    [-0.22, 0.13],
    [0.19, -0.12],
  ]) {
    cylinder(0.11, 0.1, 0.2, COLORS.cream, table, x, 0.71, z, 12);
    cylinder(0.084, 0.084, 0.006, COLORS.bark, table, x, 0.814, z, 12);
    mesh(
      new THREE.TorusGeometry(0.067, 0.021, 5, 12),
      COLORS.cream,
      table,
      x + 0.12,
      0.72,
      z,
    );
  }

  function tent(x, z, angle, color) {
    const shelter = group(camp, x, 0, z, angle);
    const vertices = new Float32Array([
      -1.15, 0.06, -1.1, 0, 1.65, -1.1, 0, 1.65, 1.1, -1.15, 0.06, -1.1, 0,
      1.65, 1.1, -1.15, 0.06, 1.1, 1.15, 0.06, -1.1, 1.15, 0.06, 1.1, 0, 1.65,
      1.1, 1.15, 0.06, -1.1, 0, 1.65, 1.1, 0, 1.65, -1.1, -1.15, 0.06, -1.1,
      1.15, 0.06, -1.1, 0, 1.65, -1.1,
    ]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    mesh(geometry, material(color, { side: THREE.DoubleSide }), shelter);
    box(2.22, 0.045, 2.17, COLORS.cream, shelter, 0, 0.05, 0);
    box(0.67, 0.14, 1.35, COLORS.blue, shelter, -0.38, 0.16, -0.15);
    box(0.64, 0.13, 0.35, COLORS.cream, shelter, -0.38, 0.24, -0.68);
    for (const front of [-1.13, 1.13]) {
      bar([-1.21, 0.05, front], [0, 1.74, front], 0.047, COLORS.cream, shelter);
      bar([1.21, 0.05, front], [0, 1.74, front], 0.047, COLORS.cream, shelter);
    }
    bar([0, 1.73, -1.23], [0, 1.73, 1.23], 0.042, COLORS.wood, shelter);
    for (const side of [-1, 1]) {
      bar(
        [side * 0.78, 0.58, 0.73],
        [side * 1.51, 0.05, 1.16],
        0.013,
        COLORS.cream,
        shelter,
      );
      cylinder(
        0.043,
        0.043,
        0.2,
        COLORS.wood,
        shelter,
        side * 1.51,
        0.09,
        1.16,
        5,
      );
    }
  }
  tent(-2.8, -2.08, 0.25, COLORS.sage);
  tent(2.65, -1.9, -0.25, COLORS.yellow);

  const posts = [
    [-4.3, -0.9],
    [0, 4.15],
    [4.3, -0.9],
  ];
  for (const [x, z] of posts) {
    cylinder(0.09, 0.12, 3.55, COLORS.wood, camp, x, 1.76, z, 8);
    cylinder(0.15, 0.13, 0.12, COLORS.cream, camp, x, 3.54, z, 8);
  }
  for (let span = 0; span < 2; span++) {
    const from = posts[span];
    const to = posts[span + 1];
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(from[0], 3.45, from[1]),
      new THREE.Vector3((from[0] + to[0]) / 2, 2.8, (from[1] + to[1]) / 2),
      new THREE.Vector3(to[0], 3.45, to[1]),
    ]);
    mesh(new THREE.TubeGeometry(curve, 24, 0.018, 4, false), COLORS.bark, camp);
    for (let index = 1; index < 9; index++) {
      const point = curve.getPoint(index / 9);
      cylinder(
        0.025,
        0.025,
        0.14,
        COLORS.bark,
        camp,
        point.x,
        point.y - 0.065,
        point.z,
        5,
      );
      const color =
        index % 3 === 0
          ? COLORS.coral
          : index % 3 === 1
            ? COLORS.cream
            : COLORS.yellow;
      const bulb = mesh(
        new THREE.IcosahedronGeometry(0.1, 1),
        material(color, { emissive: color, emissiveIntensity: 0.55 }),
        camp,
        point.x,
        point.y - 0.18,
        point.z,
      );
      bulb.castShadow = false;
      bulbs.push({ mesh: bulb, phase: index + span * 4 });
    }
  }

  function hit(position, speed, elapsed) {
    if (
      !position ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.z) ||
      !Number.isFinite(speed) ||
      !Number.isFinite(elapsed)
    )
      return null;
    for (const attraction of ATTRACTIONS) {
      const record = records.get(attraction.id);
      if (elapsed - record.lastHit < COOLDOWNS[attraction.kind]) continue;
      if (attraction.kind === "pop" && Math.abs(speed) <= 1) continue;
      if (
        Math.hypot(position.x - attraction.x, position.z - attraction.z) <=
        attraction.r + 0.45
      )
        return attraction;
    }
    return null;
  }

  function play(id, elapsed, remote = false) {
    const record = records.get(id);
    if (!record || !Number.isFinite(elapsed)) return false;
    // Pads and bumpers have per-driver cooldowns; a peer's visual effect must
    // not prevent this driver from activating them. Crates are shared objects.
    const consumesCooldown = !remote || record.attraction.kind === "pop";
    if (
      consumesCooldown &&
      elapsed - record.lastHit < COOLDOWNS[record.attraction.kind]
    )
      return false;
    if (consumesCooldown) record.lastHit = elapsed;
    record.lastVisual = elapsed;
    record.flash.visible = true;
    record.flash.material.opacity = 0.85;
    record.flash.scale.setScalar(1);
    if (record.attraction.kind === "pop") {
      record.moving.visible = false;
      burst(record.attraction, 22, 3.1);
    } else if (record.attraction.kind === "bounce") {
      burst(record.attraction, 8, 1.6);
    } else if (record.attraction.kind === "jump") {
      burst(record.attraction, 10, 1.3);
    } else {
      burst(record.attraction, 7, 1.8);
    }
    return true;
  }

  function update(dt, elapsed) {
    if (!Number.isFinite(elapsed)) return;
    const delta = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.1) : 0;
    for (const record of records.values()) {
      const age = elapsed - record.lastVisual;
      const kind = record.attraction.kind;
      if (kind === "pop") {
        record.moving.visible = age >= COOLDOWNS.pop;
        const grown = Math.min(1, Math.max(0, (age - COOLDOWNS.pop) / 0.34));
        record.moving.scale.setScalar(grown);
      } else if (kind === "bounce") {
        const wave =
          age >= 0 && age < 0.8 ? Math.sin(age * 21) * Math.exp(-age * 5) : 0;
        record.moving.scale.set(
          1 + wave * 0.17,
          1 - wave * 0.33,
          1 + wave * 0.17,
        );
        record.moving.position.y = 0.67 - wave * 0.2;
      } else if (kind === "jump") {
        const springAmount =
          age >= 0 && age < 1 ? Math.sin(age * 18) * Math.exp(-age * 4.4) : 0;
        record.moving.position.y = 0.63 + springAmount * 0.3;
        record.surface.emissiveIntensity =
          0.035 + night * 0.8 + Math.max(0, 1 - age / 0.65) * (0.65 + night);
      } else {
        record.surface.emissiveIntensity =
          0.065 +
          night * 0.75 +
          Math.sin(elapsed * 2.5) * 0.035 +
          Math.max(0, 1 - age / 0.7) * (0.75 + night);
      }
      record.flash.material.emissiveIntensity = 0.2 + night * 2;
      if (age >= 0 && age < 0.65) {
        record.flash.visible = true;
        record.flash.scale.setScalar(1 + age * 1.8);
        record.flash.material.opacity = (1 - age / 0.65) * 0.8;
      } else {
        record.flash.visible = false;
      }
    }

    for (const particle of particles) {
      if (particle.life <= 0) continue;
      particle.life -= delta;
      if (particle.life <= 0) {
        particle.mesh.visible = false;
        continue;
      }
      particle.vy -= 7.5 * delta;
      particle.mesh.position.x += particle.vx * delta;
      particle.mesh.position.y += particle.vy * delta;
      particle.mesh.position.z += particle.vz * delta;
      particle.mesh.rotation.x += particle.spin * delta;
      particle.mesh.rotation.z += particle.spin * 0.7 * delta;
      if (particle.mesh.position.y < 0.09) {
        particle.mesh.position.y = 0.09;
        particle.vy = Math.abs(particle.vy) * 0.33;
        particle.vx *= 0.68;
        particle.vz *= 0.68;
      }
      if (particle.life < 0.3)
        particle.mesh.scale.setScalar(particle.life / 0.3);
    }

    for (const flame of flameMeshes) {
      const flicker =
        Math.sin(elapsed * 7 + flame.phase) * 0.09 +
        Math.sin(elapsed * 12.3 + flame.phase) * 0.04;
      flame.mesh.scale.set(1 - flicker * 0.4, 1 + flicker, 1 - flicker * 0.3);
      flame.mesh.position.y = flame.y + flicker * 0.14;
      flame.mesh.rotation.y = elapsed * 0.17 + flame.phase;
      flame.mesh.rotation.z = Math.sin(elapsed * 4 + flame.phase) * 0.055;
      flame.mesh.material.emissiveIntensity = 0.38 + night * (3.1 + flicker);
    }
    fireLight.intensity =
      1.2 + night * 5.2 + Math.sin(elapsed * 8.1) * (0.14 + night * 0.2);
    for (const puff of smoke) {
      const progress = (elapsed * 0.24 + puff.phase) % 1;
      puff.mesh.position.set(
        Math.sin(progress * 5 + puff.phase) * 0.16 + progress * 0.38,
        1.18 + progress * 1.9,
        progress * 0.16,
      );
      puff.mesh.scale.setScalar(
        (0.4 + progress * 1.2) * Math.sin(progress * Math.PI),
      );
      puff.mesh.rotation.y = elapsed * 0.25 + puff.phase;
    }
    for (const bulb of bulbs)
      bulb.mesh.material.emissiveIntensity =
        0.5 + night * 3.4 + Math.sin(elapsed * 1.2 + bulb.phase) * 0.1;
  }

  return {
    hit,
    play,
    update,
    setNight(value) {
      night = Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0;
    },
  };
}
