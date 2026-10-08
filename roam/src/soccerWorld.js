import * as THREE from "three";
import { SOCCER, soccerBall, isSoccerDriveable } from "./soccerConfig.js";

const TAU = Math.PI * 2;
const INTERPOLATION_DELAY = 0.075;
const MAX_EXTRAPOLATION = 0.1;

export function soccerViewSize(canvasWidth, canvasHeight, contentWidth) {
  return Math.max(
    43,
    (58 * canvasHeight) / Math.min(canvasWidth, contentWidth),
  );
}

export function soccerPoseTransfer(match, playerId, pose, previous = null) {
  if (!match?.players?.some((player) => player.id === playerId)) return null;
  const active = ["countdown", "playing", "goal"].includes(match.status);
  const onPitch = isSoccerDriveable(pose.x, pose.z);
  if (onPitch) return active ? null : "entering";
  if (active || previous === "entering") return "leaving";
  return previous;
}

/** Static pitch and a presentation-only ball; game physics stay on the server. */
export function createSoccerWorld(scene, { reducedMotion = false } = {}) {
  const root = new THREE.Group();
  root.name = "soccer-field";
  root.position.set(SOCCER.cx, 0, SOCCER.cz);
  scene.add(root);
  const geometries = new Set(),
    materials = new Set(),
    glow = [];
  const paints = new Map();
  let disposed = false,
    elapsed = 0,
    match = null,
    night = 0;
  let resetKey = "",
    lastPacket = "",
    samples = [];
  const previousBall = new THREE.Vector3();
  const rotationAxis = new THREE.Vector3();
  function paint(color, emission = false) {
    const key = `${color}:${emission}`;
    if (!paints.has(key)) {
      const material = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.78,
        ...(emission ? { emissive: color, emissiveIntensity: 0.15 } : {}),
      });
      paints.set(key, material);
      materials.add(material);
      if (emission) glow.push(material);
    }
    return paints.get(key);
  }
  function mesh(geometry, material, x = 0, y = 0, z = 0, parent = root) {
    geometries.add(geometry);
    const value = new THREE.Mesh(
      geometry,
      typeof material === "string" ? paint(material) : material,
    );
    value.position.set(x, y, z);
    value.castShadow = value.receiveShadow = true;
    parent.add(value);
    return value;
  }
  function box(w, h, d, color, x = 0, y = 0, z = 0) {
    return mesh(new THREE.BoxGeometry(w, h, d), color, x, y, z);
  }
  const L = SOCCER.halfLength,
    W = SOCCER.halfWidth;
  box(L * 2 + 1.4, 1.65, W * 2 + 1.4, "#aaa78f", 0, -0.86);
  const surface = box(L * 2, 0.12, W * 2, "#a0b681", 0, -0.045);
  surface.name = "soccer-playing-surface";
  surface.castShadow = false;
  const stripeGeometry = new THREE.PlaneGeometry((L * 2) / 10, W * 2);
  stripeGeometry.rotateX(-Math.PI / 2);
  geometries.add(stripeGeometry);
  const stripes = new THREE.InstancedMesh(stripeGeometry, paint("#94ab76"), 5);
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < 5; i++)
    stripes.setMatrixAt(
      i,
      matrix.makeTranslation(-L + ((i * 2 + 0.5) * L) / 5, 0.019, 0),
    );
  stripes.receiveShadow = true;
  stripes.name = "soccer-grass-stripes";
  root.add(stripes);
  const linePaint = paint("#f1edda");
  const lines = [];
  const segment = (x1, z1, x2, z2, y = 0.037) =>
    lines.push(x1, y, z1, x2, y, z2);
  const rectangle = (left, right, top, bottom) => {
    segment(left, top, right, top);
    segment(right, top, right, bottom);
    segment(right, bottom, left, bottom);
    segment(left, bottom, left, top);
  };
  rectangle(-L + 0.18, L - 0.18, -W + 0.18, W - 0.18);
  segment(0, -W + 0.18, 0, W - 0.18);
  for (let i = 0; i < 64; i++) {
    const a = (i * TAU) / 64,
      b = ((i + 1) * TAU) / 64;
    segment(Math.cos(a) * 4, Math.sin(a) * 4, Math.cos(b) * 4, Math.sin(b) * 4);
  }
  for (const sign of [-1, 1])
    rectangle(sign * (L - 5.3), sign * (L - 0.18), -7, 7);
  const fieldLineGeometry = new THREE.BufferGeometry();
  fieldLineGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(lines, 3),
  );
  geometries.add(fieldLineGeometry);
  const fieldLineMaterial = new THREE.LineBasicMaterial({ color: "#f7f2dd" });
  materials.add(fieldLineMaterial);
  const fieldLines = new THREE.LineSegments(
    fieldLineGeometry,
    fieldLineMaterial,
  );
  fieldLines.name = "soccer-field-markings";
  root.add(fieldLines);
  const center = mesh(new THREE.CircleGeometry(0.18, 16), linePaint, 0, 0.04);
  center.rotation.x = -Math.PI / 2;
  center.castShadow = false;
  // The rim marks solid side walls; the colored goal mouths remain open.
  for (const z of [-W - 0.13, W + 0.13]) {
    box(L * 2 + 0.4, 0.48, 0.24, "#d5cfb6", 0, 0.22, z);
    box(L * 2, 0.07, 0.075, paint("#d8e8b2", true), 0, 0.49, z);
  }
  const netPositions = [];
  const netLine = (a, b) => netPositions.push(...a, ...b);
  const gh = SOCCER.goalHeight,
    gw = SOCCER.goalHalfWidth,
    depth = SOCCER.goalDepth;
  for (const [team, sign, color] of [
    ["blue", -1, "#75aed1"],
    ["orange", 1, "#e6a06c"],
  ]) {
    const goalPaint = paint(color, true);
    const x = sign * L,
      back = sign * (L + depth);
    const foundation = box(
      depth,
      0.2,
      gw * 2 + 0.4,
      "#b8b69b",
      sign * (L + depth / 2),
      -0.1,
    );
    foundation.name = `soccer-${team}-goal`;
    for (const z of [-gw, gw]) {
      box(0.2, gh, 0.2, goalPaint, x, gh / 2, z);
      box(depth + 0.2, 0.15, 0.15, goalPaint, sign * (L + depth / 2), gh, z);
      box(0.15, gh, 0.15, "#d9dac7", back, gh / 2, z);
      for (let n = 0; n <= 6; n++) {
        const nx = x + ((back - x) * n) / 6;
        netLine([nx, 0, z], [nx, gh, z]);
      }
      for (let y = 0; y <= gh; y += 0.45) netLine([x, y, z], [back, y, z]);
    }
    box(0.22, 0.22, gw * 2 + 0.22, goalPaint, x, gh, 0);
    box(0.15, 0.15, gw * 2, "#d9dac7", back, gh, 0);
    for (let z = -gw; z <= gw; z += 0.5) {
      netLine([back, 0, z], [back, gh, z]);
      netLine([x, gh, z], [back, gh, z]);
    }
    for (let y = 0; y <= gh; y += 0.45) netLine([back, y, -gw], [back, y, gw]);
    for (const side of [-1, 1]) {
      const w = W - gw;
      box(0.24, 0.48, w, "#d5cfb6", x, 0.22, side * (gw + w / 2));
      box(0.075, 0.07, w, goalPaint, x, 0.49, side * (gw + w / 2));
    }
  }
  const netGeometry = new THREE.BufferGeometry();
  netGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(netPositions, 3),
  );
  geometries.add(netGeometry);
  const netMaterial = new THREE.LineBasicMaterial({
    color: "#f0eee0",
    transparent: true,
    opacity: 0.54,
  });
  materials.add(netMaterial);
  const net = new THREE.LineSegments(netGeometry, netMaterial);
  net.name = "soccer-goal-nets";
  root.add(net);
  const ball = new THREE.Group();
  ball.name = "soccer-ball";
  root.add(ball);
  const r = SOCCER.ballRadius;
  mesh(new THREE.SphereGeometry(r, 24, 16), "#f7f4e6", 0, 0, 0, ball);
  // Twelve curved pentagons give the ball a readable classic football pattern.
  const directions = new THREE.IcosahedronGeometry(1, 0);
  const unique = new Map();
  const attribute = directions.getAttribute("position");
  for (let i = 0; i < attribute.count; i++) {
    const normal = new THREE.Vector3()
      .fromBufferAttribute(attribute, i)
      .normalize();
    unique.set(
      normal
        .toArray()
        .map((v) => v.toFixed(4))
        .join(","),
      normal,
    );
  }
  directions.dispose();
  const patchVertices = [];
  const patchTriangle = (a, b, c, depth) => {
    if (depth > 0) {
      const ab = a.clone().add(b).normalize();
      const bc = b.clone().add(c).normalize();
      const ca = c.clone().add(a).normalize();
      patchTriangle(a, ab, ca, depth - 1);
      patchTriangle(ab, b, bc, depth - 1);
      patchTriangle(ca, bc, c, depth - 1);
      patchTriangle(ab, bc, ca, depth - 1);
      return;
    }
    for (const point of [a, b, c])
      patchVertices.push(
        ...point
          .clone()
          .multiplyScalar(r * 1.003)
          .toArray(),
      );
  };
  for (const normal of unique.values()) {
    const tangent = new THREE.Vector3(0, 1, 0).cross(normal).normalize();
    if (tangent.lengthSq() < 0.1) tangent.set(1, 0, 0);
    const bitangent = normal.clone().cross(tangent).normalize();
    const point = (angle) =>
      normal
        .clone()
        .addScaledVector(tangent, Math.cos(angle) * 0.3)
        .addScaledVector(bitangent, Math.sin(angle) * 0.3)
        .normalize();
    for (let i = 0; i < 5; i++)
      patchTriangle(
        normal,
        point((i * TAU) / 5),
        point(((i + 1) * TAU) / 5),
        2,
      );
  }
  const patchGeometry = new THREE.BufferGeometry();
  patchGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(patchVertices, 3),
  );
  patchGeometry.computeVertexNormals();
  mesh(patchGeometry, "#35423d", 0, 0, 0, ball);
  function setBall(value) {
    ball.position.set(
      value.x - SOCCER.cx,
      Math.max(r, value.y),
      value.z - SOCCER.cz,
    );
    previousBall.copy(ball.position);
  }
  setBall(soccerBall());
  function setMatch(value) {
    if (disposed) return;
    match = value || null;
    const state = match?.ball || soccerBall();
    if (
      ![state.x, state.y, state.z, state.vx, state.vy, state.vz].every(
        Number.isFinite,
      )
    )
      return;
    const key = `${match?.id || "preview"}:${match?.sequence ?? 0}:${match?.status || "waiting"}`;
    const packet = [
      key,
      state.x,
      state.y,
      state.z,
      state.vx,
      state.vy,
      state.vz,
    ].join(":");
    if (packet === lastPacket) return;
    lastPacket = packet;
    const sample = { ...state, time: elapsed };
    if (key !== resetKey || !samples.length) {
      resetKey = key;
      samples = [sample];
      ball.rotation.set(0, 0, 0);
      setBall(state);
    } else {
      if (samples.at(-1).time === elapsed) samples.pop();
      samples.push(sample);
      if (samples.length > 5) samples.shift();
    }
  }
  function update(_dt, time) {
    if (disposed) return;
    if (Number.isFinite(time)) elapsed = Math.max(elapsed, time);
    if (!samples.length || match?.status !== "playing") return;
    const renderAt = elapsed - INTERPOLATION_DELAY;
    let a = samples[0],
      b = null;
    for (const sample of samples) {
      if (sample.time <= renderAt) a = sample;
      else {
        b = sample;
        break;
      }
    }
    previousBall.copy(ball.position);
    if (b && b !== a && b.time > a.time) {
      const t = THREE.MathUtils.clamp(
        (renderAt - a.time) / (b.time - a.time),
        0,
        1,
      );
      ball.position.set(
        THREE.MathUtils.lerp(a.x, b.x, t) - SOCCER.cx,
        Math.max(r, THREE.MathUtils.lerp(a.y, b.y, t)),
        THREE.MathUtils.lerp(a.z, b.z, t) - SOCCER.cz,
      );
    } else {
      const ahead = THREE.MathUtils.clamp(
        renderAt - a.time,
        0,
        MAX_EXTRAPOLATION,
      );
      ball.position.set(
        a.x + a.vx * ahead - SOCCER.cx,
        Math.max(r, a.y + a.vy * ahead),
        a.z + a.vz * ahead - SOCCER.cz,
      );
    }
    if (!reducedMotion) {
      rotationAxis.set(
        ball.position.z - previousBall.z,
        0,
        previousBall.x - ball.position.x,
      );
      const distance = rotationAxis.length();
      if (distance > 1e-8 && distance < 5)
        ball.rotateOnWorldAxis(rotationAxis.normalize(), distance / r);
    }
  }
  function setNight(value) {
    if (disposed || !Number.isFinite(value)) return;
    night = THREE.MathUtils.clamp(value, 0, 1);
    for (const material of glow)
      material.emissiveIntensity = 0.15 + night * 1.5;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    root.removeFromParent();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    samples = [];
  }
  return { setMatch, setNight, update, dispose };
}
