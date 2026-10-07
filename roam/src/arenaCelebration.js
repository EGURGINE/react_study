import * as THREE from "three";
import { ARENA } from "./arenaConfig.js";

const SLOT_COUNT = 3;
const PARTICLES_PER_SLOT = 128;
const CAPACITY = SLOT_COUNT * PARTICLES_PER_SLOT;
const COLORS = ["#7fddd9", "#f5cc72", "#eea08c", "#bda4ef"];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** One pooled draw call, outside the arena's replaceable architecture group. */
export function createArenaCelebration(scene, { reducedMotion = false } = {}) {
  const root = new THREE.Group();
  root.name = "arena-celebration";
  root.position.set(ARENA.cx, 0, ARENA.cz);
  scene.add(root);
  const positions = new Float32Array(CAPACITY * 3);
  const colors = new Float32Array(CAPACITY * 3);
  const sizes = new Float32Array(CAPACITY);
  const opacity = new Float32Array(CAPACITY);
  const geometry = new THREE.BufferGeometry();
  for (const [name, array, size] of [
    ["position", positions, 3],
    ["aColor", colors, 3],
    ["aSize", sizes, 1],
    ["aOpacity", opacity, 1],
  ])
    geometry.setAttribute(
      name,
      new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage),
    );
  // Includes rockets from a previous, larger layout after a radius change.
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(0, 7, 0),
    ARENA.maxRadius + 20,
  );
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: { uPointScale: { value: 12 }, uBrightness: { value: 0.8 } },
    vertexShader: `
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aOpacity;
      uniform float uPointScale;
      varying vec3 vColor;
      varying float vOpacity;
      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        float perspectiveScale = projectionMatrix[2][3] == -1.0 ? 1.0 / max(0.01, -viewPosition.z) : 1.0;
        gl_PointSize = clamp(aSize * uPointScale * perspectiveScale, 1.0, 18.0);
        vColor = aColor;
        vOpacity = aOpacity;
      }
    `,
    fragmentShader: `
      uniform float uBrightness;
      varying vec3 vColor;
      varying float vOpacity;
      void main() {
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float radius2 = dot(p, p);
        if (radius2 > 1.0 || vOpacity <= 0.0) discard;
        float softEdge = pow(1.0 - radius2, 1.7);
        float core = 1.0 + 0.3 * exp(-radius2 * 18.0);
        gl_FragColor = vec4(vColor * uBrightness * core, vOpacity * softEdge);
        #include <colorspace_fragment>
      }
    `,
  });
  const points = new THREE.Points(geometry, material);
  points.name = "arena-firework-particles";
  points.visible = false;
  root.add(points);
  const resolution = new THREE.Vector2();
  points.onBeforeRender = (renderer, _scene, camera) => {
    renderer.getDrawingBufferSize(resolution);
    material.uniforms.uPointScale.value =
      (resolution.y * Math.abs(camera.projectionMatrix.elements[5])) / 2;
  };
  const palette = COLORS.map((color) => new THREE.Color(color));
  const slots = Array.from({ length: SLOT_COUNT }, (_, index) => ({
    index,
    active: false,
    sparkCount: 0,
    sparks: Array.from({ length: PARTICLES_PER_SLOT }, () => ({})),
  }));
  const seen = new Set();
  let pending = [],
    radius = ARENA.minRadius,
    now = 0,
    lastElapsed = null;
  let nextIdle = null,
    disposed = false,
    launchIndex = 0,
    randomState = 0x4c1ee;
  const random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 4294967296;
  };
  function write(index, x, y, z, color, size, alpha) {
    const offset = index * 3;
    positions[offset] = x;
    positions[offset + 1] = y;
    positions[offset + 2] = z;
    colors[offset] = color.r;
    colors[offset + 1] = color.g;
    colors[offset + 2] = color.b;
    sizes[index] = size;
    opacity[index] = alpha;
  }
  function launch(slot, at, kind) {
    const angle =
      -0.55 +
      ((launchIndex * 2.399963229728653) % 2.85) +
      (random() - 0.5) * 0.18;
    const radial = radius + 4.1;
    const flight = 0.78 + random() * 0.2;
    Object.assign(slot, {
      active: true,
      at,
      kind,
      flight,
      x: Math.cos(angle) * radial,
      z: Math.sin(angle) * radial,
      targetX: Math.cos(angle) * (radial + 1.5),
      targetZ: Math.sin(angle) * (radial + 1.5),
      targetY: 7.2 + random() * 1.8,
      color: palette[launchIndex++ % palette.length],
    });
    const count = kind === "winner" ? 124 : kind === "start" ? 112 : 100;
    slot.sparkCount = count;
    for (let i = 0; i < count; i++) {
      const vertical = 1 - (2 * (i + 0.5)) / count;
      const side = Math.sqrt(Math.max(0, 1 - vertical * vertical));
      const turn = i * 2.399963229728653 + random() * 0.18;
      const speed = (kind === "winner" ? 5 : 4.3) + random() * 2;
      Object.assign(slot.sparks[i], {
        vx: Math.cos(turn) * side * speed,
        vy: (vertical * 0.7 + 0.35) * speed,
        vz: Math.sin(turn) * side * speed,
        life: 1.35 + random() * 0.4,
        size: 0.15 + random() * 0.1,
        color:
          i % 7 === 0
            ? palette[(launchIndex + 1) % palette.length]
            : slot.color,
      });
    }
  }
  function updateSlots() {
    opacity.fill(0);
    let active = 0;
    for (const slot of slots) {
      if (!slot.active) continue;
      const age = now - slot.at;
      if (age > slot.flight + 1.75) {
        slot.active = false;
        continue;
      }
      active++;
      const first = slot.index * PARTICLES_PER_SLOT;
      if (age < slot.flight) {
        // The trail samples the same analytic rocket path at earlier times.
        for (let i = 0; i < 23; i++) {
          const sample = age - i * 0.019;
          if (sample < 0) break;
          const progress = 1 - (1 - clamp(sample / slot.flight, 0, 1)) ** 1.6;
          write(
            first + i,
            slot.x + (slot.targetX - slot.x) * progress,
            2.7 + (slot.targetY - 2.7) * progress,
            slot.z + (slot.targetZ - slot.z) * progress,
            slot.color,
            i === 0 ? 0.31 : 0.16,
            (1 - i / 23) ** 1.6,
          );
        }
      } else {
        const burstAge = age - slot.flight;
        const travel = (1 - Math.exp(-0.55 * burstAge)) / 0.55;
        for (let i = 0; i < slot.sparkCount; i++) {
          const spark = slot.sparks[i];
          if (burstAge >= spark.life) continue;
          const fade = (1 - burstAge / spark.life) ** 1.45;
          write(
            first + i,
            slot.targetX + spark.vx * travel,
            slot.targetY + spark.vy * travel - 2.7 * burstAge * burstAge,
            slot.targetZ + spark.vz * travel,
            spark.color,
            spark.size * (0.65 + fade * 0.35),
            fade,
          );
        }
      }
    }
    for (const attribute of Object.values(geometry.attributes))
      attribute.needsUpdate = true;
    points.visible = active > 0 && !reducedMotion;
  }
  return {
    setRadius(value) {
      if (Number.isFinite(value))
        radius = clamp(value, ARENA.minRadius, ARENA.maxRadius);
    },
    setNight(value) {
      const night = Number.isFinite(value) ? clamp(value, 0, 1) : 0;
      material.uniforms.uBrightness.value = 0.8 + night * 1.65;
    },
    celebrate(kind = "start", eventKey) {
      if (disposed || reducedMotion || !["start", "winner"].includes(kind))
        return false;
      if (eventKey !== undefined && eventKey !== null) {
        const key = `${kind}:${eventKey}`;
        if (seen.has(key)) return false;
        seen.add(key);
        if (seen.size > 64) seen.delete(seen.values().next().value);
      }
      const delays =
        kind === "winner" ? [0, 0.3, 0.6, 3.0, 3.3, 3.6] : [0, 0.3, 0.6];
      // A new event replaces queued effects rather than accumulating a backlog.
      pending = delays.map((delay) => ({
        due: lastElapsed === null ? null : now + delay,
        delay,
        kind,
      }));
      nextIdle = now + delays.at(-1) + 8 + random() * 4;
      return true;
    },
    update(dt, elapsed) {
      if (
        disposed ||
        reducedMotion ||
        !Number.isFinite(dt) ||
        !Number.isFinite(elapsed) ||
        dt < 0
      )
        return;
      now = elapsed;
      if (lastElapsed === null) {
        for (const item of pending)
          if (item.due === null) item.due = now + item.delay;
        nextIdle = now + 8 + random() * 4 + (pending.at(-1)?.delay || 0);
      } else if (
        elapsed < lastElapsed ||
        elapsed - lastElapsed > 0.75 ||
        dt > 0.75
      ) {
        pending = [];
        for (const slot of slots) {
          slot.active = false;
          slot.at = undefined;
        }
        nextIdle = now + 8 + random() * 4;
      }
      lastElapsed = elapsed;
      for (const slot of slots)
        if (slot.active && now - slot.at > slot.flight + 1.75)
          slot.active = false;
      if (nextIdle !== null && now >= nextIdle) {
        if (!pending.length) pending.push({ due: now, kind: "idle" });
        nextIdle = now + 8 + random() * 4;
      }
      while (pending.length && pending[0].due <= now) {
        const free = slots.find((slot) => !slot.active);
        if (!free) break;
        const item = pending.shift();
        const availableAt =
          free.at === undefined ? item.due : free.at + free.flight + 1.75;
        launch(free, Math.max(item.due, availableAt), item.kind);
      }
      updateSlots();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      pending = [];
      seen.clear();
      for (const slot of slots) {
        slot.active = false;
        slot.sparks.length = 0;
      }
      root.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}
