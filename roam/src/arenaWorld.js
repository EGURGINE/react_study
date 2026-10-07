import * as THREE from "three";
import {
  ARENA,
  ARENA_OBSTACLE_RULES,
  createArenaLayout,
} from "./arenaConfig.js";

const TAU = Math.PI * 2;
const PREVIEW = createArenaLayout(2, () => 0.37);

/** Scene-owned arena; rebuilding/removal disposes only this module's resources. */
export function createArenaWorld(scene, { reducedMotion = false } = {}) {
  const root = new THREE.Group();
  root.name = "colosseum-arena";
  root.position.set(ARENA.cx, 0, ARENA.cz);
  scene.add(root);
  const paints = new Map(),
    records = new Map(),
    glow = [],
    neon = [];
  let match = null,
    localId = null,
    signature = "",
    night = 0,
    disposed = false;
  const temp = new THREE.Object3D();
  function material(color, emission = null) {
    const key = `${color}:${emission}`;
    if (!paints.has(key)) {
      const paint = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.82,
        ...(emission
          ? { emissive: emission, emissiveIntensity: 0.02 + night * 1.4 }
          : {}),
      });
      paints.set(key, paint);
      if (emission) glow.push(paint);
    }
    return paints.get(key);
  }
  function mesh(geometry, color, parent = root, x = 0, y = 0, z = 0) {
    const object = new THREE.Mesh(
      geometry,
      typeof color === "string" ? material(color) : color,
    );
    object.position.set(x, y, z);
    object.castShadow = true;
    object.receiveShadow = true;
    parent.add(object);
    return object;
  }
  function cylinder(radius, height, color, parent = root, y = 0, sides = 48) {
    return mesh(
      new THREE.CylinderGeometry(radius, radius, height, sides),
      color,
      parent,
      0,
      y,
      0,
    );
  }
  function clear() {
    const geometries = new Set(),
      materials = new Set();
    root.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material)
        for (const paint of [object.material].flat()) materials.add(paint);
    });
    root.clear();
    for (const paint of paints.values()) materials.add(paint);
    for (const geometry of geometries) geometry.dispose();
    for (const paint of materials) paint.dispose();
    paints.clear();
    records.clear();
    glow.length = 0;
    neon.length = 0;
  }
  // All disconnected seat sections share one geometry per tier.
  function sectors(inner, outer, bottom, height, arcs, color, name) {
    const positions = [];
    const quad = (a, b, c, d) =>
      positions.push(...a, ...b, ...c, ...a, ...c, ...d);
    const point = (radius, angle, y) => [
      Math.cos(angle) * radius,
      y,
      Math.sin(angle) * radius,
    ];
    for (const [start, end] of arcs) {
      const steps = Math.max(2, Math.ceil((end - start) * 14));
      for (let i = 0; i < steps; i++) {
        const a = start + ((end - start) * i) / steps,
          b = start + ((end - start) * (i + 1)) / steps;
        const il = point(inner, a, bottom),
          ir = point(inner, b, bottom),
          ol = point(outer, a, bottom),
          or = point(outer, b, bottom);
        const itl = point(inner, a, bottom + height),
          itr = point(inner, b, bottom + height),
          otl = point(outer, a, bottom + height),
          otr = point(outer, b, bottom + height);
        quad(itl, itr, otr, otl);
        quad(il, ol, or, ir);
        quad(ol, otl, otr, or);
        quad(il, ir, itr, itl);
        if (i === 0) quad(il, itl, otl, ol);
        if (i === steps - 1) quad(ir, or, otr, itr);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const result = mesh(geometry, color);
    result.name = name;
    return result;
  }
  function neonPaint(color, strength, phase = null) {
    const paint = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      roughness: 0.55,
      emissiveIntensity: 0.08 + night * strength,
    });
    neon.push({ paint, strength, phase });
    return paint;
  }
  function lightBand(radius, y, width, arcs, paint, name) {
    const band = sectors(
      radius - width / 2,
      radius + width / 2,
      y,
      0.045,
      arcs,
      paint,
      name,
    );
    band.castShadow = false;
    band.receiveShadow = false;
    return band;
  }
  function addObstacle(obstacle) {
    const rules = ARENA_OBSTACLE_RULES[obstacle.kind];
    if (
      !rules ||
      ![obstacle.x, obstacle.z, obstacle.r].every(Number.isFinite) ||
      obstacle.r <= 0
    )
      return;
    const group = new THREE.Group();
    group.name = obstacle.id;
    group.position.set(obstacle.x - ARENA.cx, 0, obstacle.z - ARENA.cz);
    root.add(group);
    cylinder(obstacle.r, 0.12, "#ddd0b5", group, 0.06, 20);
    const moving = new THREE.Group();
    group.add(moving);
    const color = { jump: "#9dbec7", bounce: "#d79c82", boost: "#b4c67e" }[
      obstacle.kind
    ];
    const lit = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.7,
      emissive: color,
      emissiveIntensity: 0.03 + night * 0.8,
    });
    let surface;
    if (obstacle.kind === "bounce") {
      cylinder(obstacle.r * 0.7, 0.45, "#805f54", moving, 0.29, 12);
      surface = cylinder(obstacle.r * 0.96, 0.28, lit, moving, 0.48, 16);
      cylinder(obstacle.r * 0.58, 0.035, "#f1dfbb", moving, 0.635, 16);
    } else {
      surface = cylinder(obstacle.r * 0.92, 0.1, lit, moving, 0.18, 20);
      if (obstacle.kind === "jump") {
        for (const rotation of [0, Math.PI / 2]) {
          const bar = mesh(
            new THREE.BoxGeometry(obstacle.r * 0.85, 0.025, 0.13),
            "#f5ead3",
            moving,
            0,
            0.245,
            0,
          );
          bar.rotation.y = rotation;
        }
        const ring = mesh(
          new THREE.TorusGeometry(obstacle.r * 0.6, 0.035, 5, 20),
          "#f5ead3",
          moving,
          0,
          0.25,
          0,
        );
        ring.rotation.x = Math.PI / 2;
      } else {
        for (const z of [-0.38, 0.05, 0.48])
          for (const side of [-1, 1]) {
            const arrow = mesh(
              new THREE.BoxGeometry(0.12, 0.028, 0.46),
              "#f5ead3",
              moving,
              side * 0.13,
              0.245,
              z,
            );
            arrow.rotation.y = (side * Math.PI) / 4;
          }
      }
    }
    records.set(obstacle.id, {
      obstacle,
      moving,
      surface,
      lastHit: -Infinity,
      lastVisual: -Infinity,
    });
  }
  function build(layout) {
    clear();
    const radius = layout.radius;
    const base = cylinder(radius + 0.18, 2, "#b7b39e", root, -1, 80);
    base.name = "arena-foundation";
    const ground = cylinder(radius, 0.045, "#ded5b9", root, -0.005, 80);
    ground.name = "arena-playing-surface";
    ground.castShadow = false;
    const disk = mesh(
      new THREE.RingGeometry(1.4, 1.55, 48),
      "#bcb590",
      root,
      0,
      0.02,
      0,
    );
    disk.rotation.x = -Math.PI / 2;
    const edge = mesh(
      new THREE.RingGeometry(radius - 0.2, radius, 96),
      "#b49c7e",
      root,
      0,
      0.023,
      0,
    );
    edge.rotation.x = -Math.PI / 2;
    // Flush floor lighting marks the edge without pretending to be a guard.
    const cyan = neonPaint("#89dfe6", 2.45);
    const violet = neonPaint("#bbaff0", 2.3);
    const amber = neonPaint("#f0c785", 2.15);
    lightBand(radius - 0.09, 0.065, 0.11, [[0, TAU]], cyan, "arena-neon-rim");
    lightBand(
      radius + 0.16,
      -0.7,
      0.085,
      [[0, TAU]],
      violet,
      "arena-neon-underglow",
    );
    lightBand(1.5, 0.045, 0.045, [[0, TAU]], amber, "arena-center-light");
    // An open two-meter gap separates the playable disk from the architecture.
    const arcs = Array.from({ length: 8 }, (_, i) => [
      (i * TAU) / 8 + 0.12,
      ((i + 1) * TAU) / 8 - 0.12,
    ]);
    sectors(
      radius + 2.0,
      radius + 4.95,
      -1.8,
      1.65,
      arcs,
      "#b4b09a",
      "arena-seating-foundations",
    );
    for (let tier = 0; tier < 3; tier++)
      sectors(
        radius + 2 + tier * 0.8,
        radius + 2.75 + tier * 0.8,
        -0.15,
        0.48 + tier * 0.46,
        arcs,
        ["#d9cbb0", "#cec4aa", "#e2d6bd"][tier],
        `arena-seats-${tier}`,
      );
    for (let tier = 0; tier < 3; tier++)
      lightBand(
        radius + 2.7 + tier * 0.8,
        0.34 + tier * 0.46,
        0.075,
        arcs,
        [amber, cyan, violet][tier],
        `arena-seat-light-${tier}`,
      );
    sectors(
      radius + 4.45,
      radius + 4.95,
      2.25,
      0.28,
      arcs,
      "#d8ccb1",
      "arena-colonnade-crowns",
    );
    for (const [index, arc] of arcs.entries()) {
      // A slow traveling glow around the stands, without strobing the floor.
      const paint = neonPaint(
        index % 2 ? "#f0c785" : "#a7cbe9",
        2.7,
        (index * TAU) / arcs.length,
      );
      lightBand(
        radius + 4.72,
        2.54,
        0.13,
        [arc],
        paint,
        `arena-crown-light-${index}`,
      );
      for (const angle of arc) {
        const bar = mesh(
          new THREE.CylinderGeometry(0.045, 0.045, 2.12, 6),
          paint,
          root,
          Math.cos(angle) * (radius + 4.98),
          1.26,
          Math.sin(angle) * (radius + 4.98),
        );
        bar.name = `arena-column-light-${index}`;
        bar.castShadow = bar.receiveShadow = false;
      }
    }
    const columns = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.15, 0.23, 2.5, 8),
      material("#d1c6ae"),
      32,
    );
    let column = 0;
    for (const [start, end] of arcs)
      for (let i = 0; i < 4; i++) {
        const angle = start + ((end - start) * i) / 3;
        temp.position.set(
          Math.cos(angle) * (radius + 4.7),
          1,
          Math.sin(angle) * (radius + 4.7),
        );
        temp.updateMatrix();
        columns.setMatrixAt(column++, temp.matrix);
      }
    columns.name = "arena-stone-columns";
    columns.castShadow = true;
    columns.receiveShadow = true;
    root.add(columns);
    const guardPaint = material("#b9c5bd", "#9fcbd1");
    for (const guard of layout.guards || []) {
      const arc = [
        [guard.angle - guard.halfAngle, guard.angle + guard.halfAngle],
      ];
      for (const y of [0.25, 0.85, 1.43, 1.9]) {
        const rail = sectors(
          radius - ARENA.guardThickness / 2,
          radius + ARENA.guardThickness / 2,
          y,
          0.1,
          arc,
          guardPaint,
          `${guard.id}-rail`,
        );
        rail.castShadow = false;
      }
      for (const angle of [arc[0][0], guard.angle, arc[0][1]]) {
        const post = mesh(
          new THREE.CylinderGeometry(
            ARENA.guardThickness / 2,
            ARENA.guardThickness / 2,
            ARENA.guardHeight,
            8,
          ),
          "#919d96",
          root,
          Math.cos(angle) * radius,
          ARENA.guardHeight / 2,
          Math.sin(angle) * radius,
        );
        post.name = `${guard.id}-post`;
      }
    }
    for (const obstacle of layout.obstacles || []) addObstacle(obstacle);
  }
  function setMatch(value, playerId) {
    if (disposed) return;
    match = value || null;
    localId = playerId || null;
    const source = match?.layout || match;
    const layout = source && Number.isFinite(source.radius) ? source : PREVIEW;
    const next = JSON.stringify([
      match?.id || "preview",
      layout.radius,
      layout.guards,
      layout.obstacles,
    ]);
    if (signature === next) return;
    signature = next;
    build(layout);
  }
  function isActive() {
    return (
      match?.status === "running" &&
      match.players?.some(
        (player) => player.id === localId && player.alive !== false,
      )
    );
  }
  function hit(position, speed, elapsed) {
    if (
      disposed ||
      !isActive() ||
      ![position?.x, position?.z, position?.y ?? 0, speed, elapsed].every(
        Number.isFinite,
      )
    )
      return null;
    for (const record of records.values()) {
      const rules = ARENA_OBSTACLE_RULES[record.obstacle.kind];
      if (
        (position.y || 0) > rules.maxTriggerHeight ||
        elapsed - record.lastHit < rules.cooldownMs / 1000
      )
        continue;
      if (
        Math.hypot(
          position.x - record.obstacle.x,
          position.z - record.obstacle.z,
        ) <=
        record.obstacle.r + ARENA.carRadius
      )
        return record.obstacle;
    }
    return null;
  }
  function play(id, elapsed, remote = false, arenaId = match?.id) {
    const record = records.get(id);
    if (
      disposed ||
      !record ||
      arenaId !== match?.id ||
      match?.status !== "running" ||
      !Number.isFinite(elapsed)
    )
      return false;
    if (!remote) {
      if (
        !isActive() ||
        elapsed - record.lastHit <
          ARENA_OBSTACLE_RULES[record.obstacle.kind].cooldownMs / 1000
      )
        return false;
      record.lastHit = elapsed;
    }
    record.lastVisual = elapsed;
    return true;
  }
  setMatch(null, null);
  return {
    setMatch,
    hit,
    play,
    setNight(value) {
      night = Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0;
      for (const paint of glow) paint.emissiveIntensity = 0.02 + night * 1.4;
      for (const { paint, strength } of neon)
        paint.emissiveIntensity = 0.08 + night * strength;
      for (const record of records.values())
        record.surface.material.emissiveIntensity = 0.03 + night * 0.8;
    },
    update(_dt, elapsed) {
      if (disposed || !Number.isFinite(elapsed)) return;
      for (const { paint, strength, phase } of neon) {
        const glow =
          reducedMotion || phase === null
            ? 1
            : 0.82 + 0.18 * Math.sin(elapsed * 0.8 - phase);
        paint.emissiveIntensity = 0.08 + night * strength * glow;
      }
      for (const record of records.values()) {
        const age = elapsed - record.lastVisual;
        const wave =
          age >= 0 && age < 0.8 ? Math.sin(age * 18) * Math.exp(-age * 5) : 0;
        record.moving.scale.set(
          1 + wave * 0.12,
          1 - wave * 0.22,
          1 + wave * 0.12,
        );
        record.surface.material.emissiveIntensity =
          0.03 +
          night * 0.8 +
          (age >= 0 ? Math.max(0, 1 - age / 0.6) : 0) * 0.55;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clear();
      root.removeFromParent();
    },
  };
}
