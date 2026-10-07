import * as THREE from "three";

// Dimensions apply to existing wheel pivots, preserving shared tire geometry
// and the world's steering/spin references. [track half-width, axle, radius, width]
export const CAR_WHEELS = Object.freeze({
  jeep: [0.59, 0.64, 0.32, 0.24],
  buggy: [0.69, 0.68, 0.34, 0.27],
  van: [0.59, 0.67, 0.29, 0.22],
  sport: [0.68, 0.68, 0.285, 0.26],
  pickup: [0.64, 0.69, 0.34, 0.27],
  roadster: [0.65, 0.66, 0.285, 0.25],
  rally: [0.65, 0.66, 0.33, 0.27],
  muscle: [0.69, 0.69, 0.31, 0.29],
  formula: [0.79, 0.72, 0.3, 0.33],
  monster: [0.82, 0.71, 0.49, 0.38],
  apex: [0.77, 0.72, 0.29, 0.3],
  venom: [0.75, 0.73, 0.275, 0.29],
  "aurora-gt": [0.71, 0.69, 0.29, 0.28],
  solstice: [0.73, 0.7, 0.28, 0.28],
  phantom: [0.78, 0.73, 0.28, 0.32],
});

/** Build a shell from shaped cross-sections and slanted glazing, then merge
 * its fixed parts by finish. Clones share geometry; each paint mesh can safely
 * receive the per-peer material clone made by world.js. Positive Z is forward. */
export function buildCarShell(shell, style) {
  const buckets = new Map();
  const roles = {
    paint: { color: "#91ae80", roughness: 0.5, metalness: 0.13 },
    carbon: { color: "#314b47", roughness: 0.75, metalness: 0.12 },
    glass: { color: "#507a80", roughness: 0.22, metalness: 0.3 },
    chrome: { color: "#c8d4c5", roughness: 0.32, metalness: 0.5 },
    cream: { color: "#f1e6c8", roughness: 0.68, metalness: 0 },
    seat: { color: "#ae836b", roughness: 0.95, metalness: 0 },
    frontLamp: { color: "#fff0c1", roughness: 0.42, metalness: 0 },
    rearLamp: { color: "#c67769", roughness: 0.42, metalness: 0 },
  };
  function add(
    shape,
    role,
    position = [0, 0, 0],
    rotation = [0, 0, 0],
    scale = [1, 1, 1],
  ) {
    const part = new THREE.Object3D();
    part.position.fromArray(position);
    part.rotation.set(...rotation);
    part.scale.fromArray(scale);
    part.updateMatrix();
    const flat = shape.index ? shape.toNonIndexed() : shape;
    flat.applyMatrix4(part.matrix);
    if (!flat.attributes.normal) flat.computeVertexNormals();
    let bucket = buckets.get(role);
    if (!bucket) {
      bucket = { positions: [], normals: [] };
      buckets.set(role, bucket);
    }
    bucket.positions.push(...flat.attributes.position.array);
    bucket.normals.push(...flat.attributes.normal.array);
    if (flat !== shape) flat.dispose();
    shape.dispose();
  }
  const box = (role, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) =>
    add(new THREE.BoxGeometry(w, h, d), role, [x, y, z], [rx, ry, rz]);
  function panel(role, corners) {
    const shape = new THREE.BufferGeometry();
    shape.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(corners.flat(), 3),
    );
    shape.setIndex([0, 1, 2, 0, 2, 3]);
    shape.computeVertexNormals();
    add(shape, role);
  }
  function bar(role, from, to, radius = 0.025) {
    const a = new THREE.Vector3(...from),
      b = new THREE.Vector3(...to);
    const direction = b.clone().sub(a);
    const shape = new THREE.CylinderGeometry(
      radius,
      radius,
      direction.length(),
      7,
    );
    shape.applyQuaternion(
      new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        direction.normalize(),
      ),
    );
    add(shape, role, a.add(b).multiplyScalar(0.5).toArray());
  }
  // Profiles are rear-to-front [z, full width, floor, crown]. Bevels prevent a
  // flat box silhouette; changing crown and width creates actual hood slopes.
  function loft(role, profiles) {
    const vertices = [],
      indices = [];
    for (const [z, width, bottom, top] of profiles) {
      const edge = Math.min((top - bottom) * 0.24, width * 0.1);
      const half = width / 2;
      for (const [x, y] of [
        [-half + edge, bottom],
        [half - edge, bottom],
        [half, bottom + edge],
        [half, top - edge],
        [half - edge, top],
        [-half + edge, top],
        [-half, top - edge],
        [-half, bottom + edge],
      ])
        vertices.push(x, y, z);
    }
    for (let row = 0; row < profiles.length - 1; row++) {
      for (let side = 0; side < 8; side++) {
        const a = row * 8 + side,
          b = row * 8 + ((side + 1) % 8);
        indices.push(a, b, a + 8, b, b + 8, a + 8);
      }
    }
    const last = (profiles.length - 1) * 8;
    for (let index = 1; index < 7; index++) {
      indices.push(0, index + 1, index);
      indices.push(last, last + index, last + index + 1);
    }
    const shape = new THREE.BufferGeometry();
    shape.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertices, 3),
    );
    shape.setIndex(indices);
    const flat = shape.toNonIndexed();
    shape.dispose();
    flat.computeVertexNormals();
    add(flat, role);
  }
  function cabin({
    front = 0.4,
    rear = -0.56,
    width = 0.97,
    base = 0.71,
    roof = 1.13,
    roofFront = 0.03,
    roofRear = -0.34,
  }) {
    loft("glass", [
      [rear, width, base, base + 0.1],
      [roofRear, width * 0.87, base, roof],
      [roofFront, width * 0.82, base, roof],
      [front, width, base, base + 0.075],
    ]);
    loft("paint", [
      [roofRear - 0.025, width * 0.9, roof - 0.018, roof + 0.046],
      [roofFront + 0.025, width * 0.86, roof - 0.018, roof + 0.046],
    ]);
    for (const side of [-1, 1])
      bar(
        "paint",
        [side * width * 0.485, base + 0.045, front],
        [side * width * 0.4, roof, roofFront],
        0.028,
      );
  }
  function seats(height = 0.68, z = -0.14, single = false) {
    for (const x of single ? [0] : [-0.255, 0.255]) {
      box("carbon", 0.38, 0.08, 0.5, x, height - 0.035, z);
      box("seat", 0.32, 0.11, 0.37, x, height + 0.03, z);
      box("seat", 0.32, 0.33, 0.105, x, height + 0.2, z - 0.23, -0.1);
    }
  }
  function windshield(width, yBottom, yTop, zBottom, zTop) {
    panel("glass", [
      [-width / 2, yBottom, zBottom],
      [width / 2, yBottom, zBottom],
      [width * 0.43, yTop, zTop],
      [-width * 0.43, yTop, zTop],
    ]);
    for (const side of [-1, 1])
      bar(
        "chrome",
        [(side * width) / 2, yBottom, zBottom],
        [side * width * 0.43, yTop, zTop],
        0.024,
      );
    bar(
      "chrome",
      [-width * 0.43, yTop, zTop],
      [width * 0.43, yTop, zTop],
      0.022,
    );
  }
  function wing(width, height, depth = 0.23, z = -0.89) {
    for (const x of [-0.43, 0.43])
      box("carbon", 0.055, height - 0.65, 0.09, x, (height + 0.65) / 2, z);
    box("carbon", width, 0.07, depth, 0, height, z, 0.035);
    for (const side of [-1, 1])
      box(
        "paint",
        0.045,
        0.2,
        depth + 0.03,
        (side * width) / 2,
        height + 0.015,
        z,
      );
  }
  function aero(width = 1.36) {
    box("carbon", width, 0.065, 0.23, 0, 0.295, 0.95);
    box("carbon", width - 0.04, 0.07, 0.22, 0, 0.31, -0.94);
    for (const x of [-0.44, -0.22, 0, 0.22, 0.44])
      box("carbon", 0.035, 0.12, 0.2, x, 0.365, -0.94, -0.22);
    for (const side of [-1, 1])
      box("carbon", 0.065, 0.095, 1.22, side * width * 0.475, 0.34, 0);
  }
  function stripe(x, width, y, length, z, slope = 0) {
    box("cream", width, 0.012, length, x, y, z, slope);
  }
  function lights() {
    // All geometry stays behind the shared emitters at Z +/-1.11.
    for (const x of [-0.425, 0.425]) {
      box("frontLamp", 0.22, 0.14, 0.035, x, 0.605, 1.035);
      box("rearLamp", 0.2, 0.115, 0.035, x, 0.58, -1.035);
    }
  }

  if (style === "van") {
    loft("paint", [
      [-1.025, 1.14, 0.35, 1.4],
      [-0.74, 1.2, 0.35, 1.48],
      [0.55, 1.2, 0.35, 1.48],
      [1.02, 1.1, 0.35, 1.1],
    ]);
    panel("glass", [
      [-0.47, 1.02, 1.027],
      [0.47, 1.02, 1.027],
      [0.51, 1.35, 0.69],
      [-0.51, 1.35, 0.69],
    ]);
    for (const side of [-1, 1]) {
      box("glass", 0.025, 0.34, 0.62, side * 0.607, 1.2, 0.11);
      box("glass", 0.025, 0.34, 0.45, side * 0.607, 1.2, -0.57);
      box("cream", 0.03, 0.06, 1.78, side * 0.611, 0.78, -0.02);
    }
    box("glass", 0.91, 0.32, 0.025, 0, 1.17, -1.039);
    box("cream", 1.0, 0.12, 0.08, 0, 0.46, 1.02);
  } else if (style === "pickup") {
    loft("paint", [
      [-1.025, 1.14, 0.43, 0.65],
      [0.48, 1.16, 0.43, 0.77],
      [1.02, 1.06, 0.43, 0.69],
    ]);
    cabin({
      front: 0.78,
      rear: -0.03,
      roofFront: 0.51,
      roofRear: 0.06,
      width: 1.05,
      base: 0.73,
      roof: 1.39,
    });
    box("carbon", 0.94, 0.035, 0.9, 0, 0.67, -0.54);
    for (const side of [-1, 1])
      box("paint", 0.13, 0.31, 0.92, side * 0.53, 0.8, -0.53);
    box("paint", 1.12, 0.3, 0.1, 0, 0.8, -0.98);
    for (const x of [-0.27, 0, 0.27])
      box("chrome", 0.028, 0.014, 0.75, x, 0.694, -0.53);
  } else if (style === "buggy") {
    loft("paint", [
      [-1.02, 1.06, 0.44, 0.69],
      [-0.62, 1.1, 0.44, 0.67],
      [0.4, 0.85, 0.44, 0.6],
      [1.02, 1.02, 0.44, 0.66],
    ]);
    seats(0.66, -0.14);
    for (const side of [-1, 1]) {
      const x = side * 0.47;
      bar("carbon", [x, 0.56, -0.57], [x, 1.39, -0.5], 0.045);
      bar("carbon", [x, 1.39, -0.5], [x, 1.26, 0.35], 0.045);
      bar("carbon", [x, 1.26, 0.35], [x, 0.59, 0.54], 0.045);
      bar("carbon", [x, 0.56, -0.57], [x, 1.26, 0.35], 0.029);
    }
    bar("carbon", [-0.47, 1.39, -0.5], [0.47, 1.39, -0.5], 0.045);
    bar("carbon", [-0.47, 1.26, 0.35], [0.47, 1.26, 0.35], 0.045);
    for (const side of [-1, 1])
      box(
        "paint",
        0.23,
        0.08,
        0.54,
        side * 0.57,
        0.73,
        0.68,
        0,
        0,
        side * 0.12,
      );
  } else if (style === "rally") {
    loft("paint", [
      [-1.02, 1.12, 0.42, 0.72],
      [-0.63, 1.24, 0.42, 0.76],
      [0.47, 1.17, 0.42, 0.75],
      [1.025, 1.05, 0.42, 0.68],
    ]);
    cabin({
      front: 0.64,
      rear: -0.87,
      roofFront: 0.24,
      roofRear: -0.63,
      width: 1.08,
      base: 0.73,
      roof: 1.21,
    });
    box("carbon", 1.07, 0.065, 0.76, 0, 1.33, -0.16);
    for (const x of [-0.34, 0, 0.34]) {
      add(
        new THREE.CylinderGeometry(0.11, 0.11, 0.11, 10),
        "frontLamp",
        [x, 1.42, 0.27],
        [Math.PI / 2, 0, 0],
      );
    }
    box("paint", 1.35, 0.08, 0.23, 0, 1.15, -0.92);
    stripe(0, 0.24, 0.785, 0.55, 0.7, 0.08);
  } else if (style === "roadster" || style === "solstice") {
    const rare = style === "solstice";
    const width = rare ? 1.38 : 1.17;
    loft("paint", [
      [-1.03, width * 0.88, 0.35, 0.68],
      [-0.69, width, 0.35, 0.77],
      [-0.29, width * 0.93, 0.35, 0.63],
      [0.4, width * 0.94, 0.35, 0.67],
      [0.8, width, 0.35, 0.7],
      [1.035, width * 0.83, 0.35, 0.52],
    ]);
    seats(0.66, -0.11);
    windshield(
      rare ? 0.98 : 0.91,
      0.73,
      rare ? 1.06 : 1.16,
      0.44,
      rare ? 0.13 : 0.3,
    );
    if (rare) {
      for (const side of [-1, 1]) {
        // Separate raised rear fairings frame an unmistakably open cockpit.
        add(
          new THREE.SphereGeometry(1, 12, 8),
          "paint",
          [side * 0.33, 0.77, -0.65],
          [0, 0, 0],
          [0.19, 0.18, 0.32],
        );
        bar(
          "chrome",
          [side * 0.25 - 0.1, 0.83, -0.44],
          [side * 0.25 - 0.1, 1.05, -0.44],
          0.025,
        );
        bar(
          "chrome",
          [side * 0.25 + 0.1, 0.83, -0.44],
          [side * 0.25 + 0.1, 1.05, -0.44],
          0.025,
        );
        bar(
          "chrome",
          [side * 0.25 - 0.1, 1.05, -0.44],
          [side * 0.25 + 0.1, 1.05, -0.44],
          0.025,
        );
      }
      aero(1.45);
    } else {
      box("chrome", 1.07, 0.065, 0.11, 0, 0.4, 1.015);
      box("chrome", 1.02, 0.065, 0.1, 0, 0.4, -1.012);
      stripe(0, 0.15, 0.718, 0.5, 0.63, 0.08);
    }
  } else if (style === "muscle") {
    loft("paint", [
      [-1.035, 1.23, 0.36, 0.69],
      [-0.68, 1.36, 0.36, 0.76],
      [0.5, 1.32, 0.36, 0.79],
      [1.035, 1.21, 0.36, 0.7],
    ]);
    cabin({
      front: 0.31,
      rear: -0.8,
      roofFront: -0.01,
      roofRear: -0.43,
      width: 1.01,
      base: 0.74,
      roof: 1.14,
    });
    box("chrome", 0.43, 0.17, 0.38, 0, 0.86, 0.58);
    box("carbon", 0.39, 0.09, 0.04, 0, 0.89, 0.788);
    for (const x of [-0.3, 0.3]) stripe(x, 0.13, 0.815, 0.58, 0.65, 0.1);
    box("chrome", 1.24, 0.08, 0.09, 0, 0.405, 1.025);
    box("carbon", 1.05, 0.08, 0.24, 0, 0.8, -0.91);
  } else if (style === "formula") {
    loft("paint", [
      [-1.025, 0.43, 0.3, 0.76],
      [-0.55, 0.67, 0.3, 0.89],
      [-0.12, 0.59, 0.3, 0.57],
      [0.5, 0.34, 0.3, 0.57],
      [1.025, 0.24, 0.3, 0.43],
    ]);
    seats(0.63, -0.11, true);
    for (const side of [-1, 1]) {
      box("paint", 0.25, 0.24, 0.64, side * 0.44, 0.52, -0.27);
      for (const z of [-0.7, 0.7]) {
        bar(
          "carbon",
          [side * 0.25, 0.4, z - 0.16],
          [side * 0.8, 0.31, z],
          0.032,
        );
        bar(
          "carbon",
          [side * 0.25, 0.4, z + 0.16],
          [side * 0.8, 0.31, z],
          0.032,
        );
      }
    }
    box("carbon", 1.67, 0.07, 0.24, 0, 0.28, 0.95);
    box("paint", 1.59, 0.06, 0.19, 0, 0.39, 0.94);
    bar("carbon", [-0.27, 0.78, -0.27], [0, 0.98, 0.02], 0.032);
    bar("carbon", [0.27, 0.78, -0.27], [0, 0.98, 0.02], 0.032);
    wing(1.43, 1.06, 0.25, -0.9);
  } else if (style === "monster") {
    loft("paint", [
      [-1.025, 1.21, 0.62, 0.93],
      [-0.43, 1.25, 0.62, 1.0],
      [0.65, 1.22, 0.62, 1.02],
      [1.025, 1.1, 0.53, 0.79],
    ]);
    cabin({
      front: 0.55,
      rear: -0.56,
      roofFront: 0.27,
      roofRear: -0.31,
      width: 1.04,
      base: 0.97,
      roof: 1.62,
    });
    for (const side of [-1, 1]) {
      for (const z of [-0.69, 0.69]) {
        bar("chrome", [side * 0.37, 0.85, z], [side * 0.76, 0.44, z], 0.055);
        box("carbon", 0.18, 0.09, 0.61, side * 0.67, 1.02, z);
      }
    }
    box("carbon", 1.18, 0.11, 0.12, 0, 0.48, 1.005);
    box("carbon", 1.16, 0.1, 0.12, 0, 0.49, -1.005);
  } else if (style === "apex") {
    loft("paint", [
      [-1.035, 1.44, 0.32, 0.71],
      [-0.72, 1.53, 0.32, 0.83],
      [-0.17, 1.24, 0.32, 0.69],
      [0.53, 1.5, 0.32, 0.71],
      [1.035, 1.27, 0.32, 0.48],
    ]);
    cabin({
      front: 0.45,
      rear: -0.66,
      roofFront: 0.06,
      roofRear: -0.32,
      width: 1.02,
      base: 0.69,
      roof: 1.11,
    });
    wing(1.7, 1.23, 0.25, -0.9);
    aero(1.55);
    for (const x of [-0.55, 0.55]) {
      box("carbon", 0.095, 0.015, 0.39, x, 0.74, 0.47, 0.15);
      stripe(x * 0.32, 0.11, 0.713, 0.5, 0.62, 0.19);
    }
  } else if (style === "venom") {
    loft("paint", [
      [-1.035, 1.45, 0.31, 0.78],
      [-0.57, 1.46, 0.31, 0.83],
      [0.31, 1.34, 0.31, 0.62],
      [1.035, 1.15, 0.31, 0.43],
    ]);
    cabin({
      front: 0.66,
      rear: -0.67,
      roofFront: 0.13,
      roofRear: -0.36,
      width: 1.04,
      base: 0.62,
      roof: 0.98,
    });
    aero(1.51);
    box("carbon", 1.39, 0.07, 0.15, 0, 0.83, -0.96, -0.14);
    for (const side of [-1, 1]) {
      panel("carbon", [
        [side * 0.701, 0.42, -0.55],
        [side * 0.704, 0.71, -0.41],
        [side * 0.684, 0.66, 0.01],
        [side * 0.68, 0.4, 0.11],
      ]);
      box("carbon", 0.18, 0.03, 0.37, side * 0.45, 0.85, -0.48, -0.13);
    }
  } else if (style === "aurora-gt") {
    loft("paint", [
      [-1.035, 1.14, 0.33, 0.59],
      [-0.85, 1.36, 0.33, 0.74],
      [-0.52, 1.39, 0.33, 0.82],
      [-0.13, 1.23, 0.33, 0.76],
      [0.3, 1.32, 0.33, 0.75],
      [0.73, 1.38, 0.33, 0.68],
      [1.035, 1.08, 0.33, 0.47],
    ]);
    add(
      new THREE.SphereGeometry(1, 20, 12),
      "glass",
      [0, 0.78, -0.19],
      [0, 0, 0],
      [0.5, 0.35, 0.62],
    );
    loft("paint", [
      [-0.62, 0.46, 0.94, 1.0],
      [-0.31, 0.75, 1.055, 1.13],
      [-0.08, 0.76, 1.07, 1.145],
      [0.14, 0.6, 0.99, 1.055],
    ]);
    aero(1.42);
    box("chrome", 1.11, 0.045, 0.1, 0, 0.71, -0.99);
    for (const side of [-1, 1])
      box("chrome", 0.026, 0.045, 1.09, side * 0.664, 0.51, -0.07);
  } else if (style === "phantom") {
    loft("paint", [
      [-1.035, 1.47, 0.3, 0.68],
      [-0.71, 1.57, 0.3, 0.78],
      [-0.14, 1.16, 0.3, 0.61],
      [0.56, 1.55, 0.3, 0.65],
      [1.035, 1.2, 0.3, 0.46],
    ]);
    cabin({
      front: 0.51,
      rear: -0.61,
      roofFront: 0.07,
      roofRear: -0.3,
      width: 0.75,
      base: 0.63,
      roof: 0.98,
    });
    aero(1.62);
    panel("carbon", [
      [-0.012, 0.73, -1.02],
      [-0.012, 1.18, -0.59],
      [-0.012, 0.97, -0.21],
      [-0.012, 0.68, -0.31],
    ]);
    for (const side of [-1, 1]) {
      panel("carbon", [
        [side * 0.18, 0.48, 1.02],
        [side * 0.33, 0.58, 0.78],
        [side * 0.49, 0.65, 0.37],
        [side * 0.3, 0.65, 0.35],
      ]);
      box(
        "carbon",
        0.075,
        0.23,
        0.4,
        side * 0.727,
        0.72,
        -0.78,
        -0.22,
        0,
        side * 0.21,
      );
    }
    box("carbon", 1.45, 0.045, 0.2, 0, 0.86, -0.91);
  } else if (style === "sport") {
    loft("paint", [
      [-1.03, 1.17, 0.34, 0.69],
      [-0.68, 1.27, 0.34, 0.74],
      [0.33, 1.17, 0.34, 0.7],
      [0.72, 1.25, 0.34, 0.65],
      [1.035, 1.02, 0.34, 0.5],
    ]);
    cabin({ front: 0.4, rear: -0.66, width: 0.94, base: 0.68, roof: 1.08 });
    aero(1.3);
    wing(1.35, 0.99, 0.2);
    for (const x of [-0.13, 0.13]) stripe(x, 0.09, 0.712, 0.54, 0.61, 0.15);
  } else {
    throw new Error(`No vehicle geometry for body style: ${style}`);
  }
  lights();
  for (const [role, bucket] of buckets) {
    const shape = new THREE.BufferGeometry();
    shape.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(bucket.positions, 3),
    );
    shape.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(bucket.normals, 3),
    );
    shape.computeBoundingBox();
    shape.computeBoundingSphere();
    const material = new THREE.MeshStandardMaterial({
      ...roles[role],
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(shape, material);
    mesh.name = `${style}-${role}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (role === "paint") mesh.userData.isBody = true;
    shell.add(mesh);
  }
}
