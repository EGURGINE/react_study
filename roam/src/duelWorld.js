import * as THREE from "three";
import { DUEL_TRACK, DUEL_LENGTH, duelPoint } from "./gameConfig.js";
import { DUEL_OBSTACLE_RULES } from "./duelObstacles.js";

/** All circuit surfaces sample the same closed centerline as race validation. */
export function createDuelWorld(scene) {
  const root = new THREE.Group();
  root.name = "duel-circuit-course";
  scene.add(root);
  const { halfWidth, laneOffset } = DUEL_TRACK;
  const glowing = [],
    materials = new Map(),
    obstacles = new Map();
  const obstacleRoot = new THREE.Group();
  obstacleRoot.name = "duel-race-obstacles";
  root.add(obstacleRoot);
  let race = null,
    lane = null,
    layoutId = null,
    night = 0;
  function mat(color) {
    if (!materials.has(color))
      materials.set(
        color,
        new THREE.MeshStandardMaterial({ color, roughness: 0.84 }),
      );
    return materials.get(color);
  }
  function neon(color, emissive, peak) {
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive,
      emissiveIntensity: 0.025,
      roughness: 0.6,
    });
    glowing.push({ material, peak });
    return material;
  }
  const cyan = neon("#bacfc3", "#86e7dc", 2.3);
  const violet = neon("#c5becd", "#c5a6ff", 2.6);
  const white = neon("#f5eed8", "#f3eacb", 1.1);
  // Wider, brighter edge tubes stay visible when the full circuit is in view.
  // Keep their materials separate so arrows and the start gate retain their glow.
  const edgeCyan = neon("#bacfc3", "#86e7dc", 2.9);
  const edgeViolet = neon("#c5becd", "#c5a6ff", 3.4);
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
  function band(from, to, height, color, name) {
    const positions = [],
      indices = [],
      segments = 256;
    for (let index = 0; index <= segments; index++) {
      for (const offset of [from, to]) {
        const point = duelPoint(index / segments, offset);
        positions.push(point.x, height, point.z);
      }
      if (index < segments) {
        const first = index * 2;
        indices.push(
          first,
          first + 2,
          first + 1,
          first + 1,
          first + 2,
          first + 3,
        );
      }
    }
    const first = new THREE.Vector3(...positions.slice(0, 3));
    const second = new THREE.Vector3(...positions.slice(6, 9));
    const third = new THREE.Vector3(...positions.slice(3, 6));
    if (second.sub(first).cross(third.sub(first)).y < 0)
      for (let index = 0; index < indices.length; index += 3)
        [indices[index + 1], indices[index + 2]] = [
          indices[index + 2],
          indices[index + 1],
        ];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const surface = mesh(geometry, color);
    surface.name = name;
    surface.castShadow = false;
    return surface;
  }
  band(
    -halfWidth - 0.35,
    halfWidth + 0.35,
    -0.045,
    "#a5b197",
    "duel-road-foundation",
  );
  // Solid inner and outer sides belong to the course itself, independent of
  // any surrounding landscape. They share the foundation's exact perimeter.
  const wallPositions = [],
    wallIndices = [];
  for (const side of [-1, 1]) {
    const first = wallPositions.length / 3;
    for (let index = 0; index <= 256; index++) {
      const point = duelPoint(index / 256, side * (halfWidth + 0.35));
      wallPositions.push(point.x, -0.045, point.z, point.x, -1.8, point.z);
      if (index < 256) {
        const a = first + index * 2;
        wallIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
  const wallGeometry = new THREE.BufferGeometry();
  wallGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(wallPositions, 3),
  );
  wallGeometry.setIndex(wallIndices);
  wallGeometry.computeVertexNormals();
  wallGeometry.computeBoundingSphere();
  const walls = mesh(
    wallGeometry,
    new THREE.MeshStandardMaterial({
      color: "#a5b197",
      roughness: 0.9,
      side: THREE.DoubleSide,
    }),
  );
  walls.name = "duel-circuit-walls";
  walls.castShadow = false;
  band(-halfWidth, halfWidth, 0.018, "#d7d9bd", "duel-road-surface");
  band(-halfWidth + 0.13, 0, 0.022, "#d4ddc7", "duel-inner-lane");
  band(0, halfWidth - 0.13, 0.024, "#ded7c9", "duel-outer-lane");
  function instances(geometry, color, transforms, name) {
    const result = new THREE.InstancedMesh(
      geometry,
      typeof color === "string" ? mat(color) : color,
      transforms.length,
    );
    result.name = name;
    const temporary = new THREE.Object3D();
    transforms.forEach((transform, index) => {
      temporary.position.set(transform.x, transform.y, transform.z);
      temporary.rotation.set(0, transform.heading || 0, 0);
      temporary.updateMatrix();
      result.setMatrixAt(index, temporary.matrix);
    });
    result.receiveShadow = true;
    root.add(result);
    return result;
  }
  // Hundreds of curb stones and markings use just a handful of draw calls.
  for (const side of [-1, 1]) {
    const points = Array.from({ length: 256 }, (_, index) => {
      const point = duelPoint(index / 256, side * (halfWidth + 0.045));
      return new THREE.Vector3(point.x, 0.16, point.z);
    });
    const line = mesh(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(points, true),
        256,
        0.06,
        8,
        true,
      ),
      side < 0 ? edgeCyan : edgeViolet,
    );
    line.name = side < 0 ? "duel-inner-neon" : "duel-outer-neon";
    line.castShadow = false;
    line.receiveShadow = false;
    const count = Math.ceil(DUEL_LENGTH / 1.1);
    for (const parity of [0, 1]) {
      const transforms = [];
      for (let index = parity; index < count; index += 2)
        transforms.push({
          ...duelPoint(index / count, side * (halfWidth - 0.08)),
          y: 0.068,
        });
      instances(
        new THREE.BoxGeometry(0.28, 0.08, 0.72),
        parity ? "#f4edd8" : "#92a989",
        transforms,
        `duel-curb-${side}-${parity}`,
      );
    }
  }
  const stripes = Math.round(DUEL_LENGTH / 2.6);
  instances(
    new THREE.BoxGeometry(0.075, 0.025, 0.92),
    "#a8b097",
    Array.from({ length: stripes }, (_, index) => ({
      ...duelPoint(index / stripes),
      y: 0.046,
    })),
    "duel-lane-divider",
  );
  for (const side of [-1, 1]) {
    const arrows = [];
    for (let distance = 10; distance < DUEL_LENGTH - 7; distance += 13) {
      const point = duelPoint(distance / DUEL_LENGTH, side * laneOffset);
      for (const arm of [-1, 1])
        arrows.push({
          x: point.x + Math.cos(point.heading) * arm * 0.23,
          z: point.z - Math.sin(point.heading) * arm * 0.23,
          y: 0.055,
          heading: point.heading - (arm * Math.PI) / 4,
        });
    }
    instances(
      new THREE.BoxGeometry(0.11, 0.026, 0.67),
      side < 0 ? cyan : violet,
      arrows,
      `duel-direction-${side}`,
    );
  }
  function label(text, sub, parent, x, y, z, width, height, floor = false) {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#eff0d5";
    ctx.fillRect(0, 0, 1024, 256);
    ctx.fillStyle = "#395e4c";
    ctx.textAlign = "center";
    ctx.font = `900 ${sub ? 96 : 150}px Arial`;
    ctx.fillText(text, 512, sub ? 126 : 181);
    if (sub) {
      ctx.font = "600 38px Arial";
      ctx.fillText(sub, 512, 207);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      emissiveMap: texture,
      emissive: "#d8e7ff",
      emissiveIntensity: 0.015,
      roughness: 0.85,
      side: THREE.DoubleSide,
    });
    glowing.push({ material, peak: 0.6 });
    const plane = mesh(
      new THREE.PlaneGeometry(width, height),
      material,
      parent,
      x,
      y,
      z,
    );
    if (floor) plane.rotation.x = -Math.PI / 2;
    return plane;
  }
  const start = duelPoint(0),
    gate = new THREE.Group();
  gate.name = "duel-start-finish-gate";
  gate.position.set(start.x, 0, start.z);
  gate.rotation.y = start.heading;
  root.add(gate);
  for (const side of [-1, 1]) {
    const pole = mesh(
      new THREE.CylinderGeometry(0.13, 0.17, 4.5, 8),
      "#8c9e81",
      gate,
      side * (halfWidth + 0.65),
      2.25,
      0,
    );
    pole.name = `duel-gate-pole-${side}`;
    box(
      0.07,
      3.6,
      0.06,
      side < 0 ? cyan : violet,
      gate,
      side * (halfWidth + 0.65),
      2.25,
      -0.16,
    );
    box(0.5, 0.15, 0.5, "#bfc5a5", gate, side * (halfWidth + 0.65), 0.075, 0);
  }
  box(halfWidth * 2 + 1.5, 0.18, 0.2, "#8b9f83", gate, 0, 4.45, 0);
  box(halfWidth * 2 + 1.4, 0.06, 0.06, white, gate, 0, 4.43, -0.15);
  label(
    "AROUND OUR WORLD",
    `${Math.round(DUEL_LENGTH)} M · ONE LAP · START / FINISH`,
    gate,
    0,
    3.88,
    -0.15,
    6.1,
    0.94,
  );
  for (let column = 0; column < 16; column++)
    for (let row = 0; row < 2; row++)
      box(
        halfWidth / 8,
        0.026,
        0.3,
        (column + row) % 2 ? white : "#526955",
        gate,
        -halfWidth + halfWidth / 16 + (column * halfWidth) / 8,
        0.065,
        row ? 0.15 : -0.15,
      );
  for (const side of [-1, 1])
    label(
      side < 0 ? "01" : "02",
      "",
      gate,
      side * laneOffset,
      0.065,
      -1.4,
      1.0,
      0.8,
      true,
    );
  for (const progress of [0.25, 0.5, 0.75]) {
    const point = duelPoint(progress, halfWidth + 1.25),
      sign = new THREE.Group();
    sign.name = `duel-quarter-sign-${progress}`;
    sign.position.set(point.x, 0, point.z);
    sign.rotation.y = point.heading;
    root.add(sign);
    for (const x of [-0.65, 0.65])
      box(0.09, 1.25, 0.1, "#92a183", sign, x, 0.625, 0);
    label(
      `${Math.round(progress * 100)}%`,
      "KEEP GOING, FRIEND",
      sign,
      0,
      1.5,
      -0.07,
      1.9,
      0.75,
    );
  }

  function clearObstacles() {
    obstacleRoot.traverse((object) => object.geometry?.dispose());
    for (const record of obstacles.values())
      for (const material of record.materials) material.dispose();
    obstacleRoot.clear();
    obstacles.clear();
    layoutId = null;
  }

  function addObstacle(obstacle) {
    const base = new THREE.Group();
    base.name = obstacle.id;
    base.position.set(obstacle.x, 0, obstacle.z);
    base.rotation.y = Number.isFinite(obstacle.heading)
      ? obstacle.heading + Math.PI
      : 0;
    obstacleRoot.add(base);
    const moving = new THREE.Group();
    base.add(moving);
    const owned = [];
    function paint(color, emissive = false) {
      const material = new THREE.MeshStandardMaterial({
        color,
        emissive: emissive ? color : "#000000",
        emissiveIntensity: emissive ? 0.05 + night * 1.5 : 0,
        roughness: 0.78,
      });
      owned.push(material);
      return material;
    }
    const jumpPad = obstacle.kind === "jump";
    const boostPad = obstacle.kind === "boost";
    const trim = paint("#f2ecd4");
    const dark = paint(boostPad ? "#6e8c4f" : jumpPad ? "#528b9e" : "#a46455");
    const surface = paint(
      boostPad ? "#b5d978" : jumpPad ? "#97d7e1" : "#efa485",
      true,
    );
    const radius = obstacle.r;
    mesh(
      new THREE.CylinderGeometry(radius, radius + 0.06, 0.1, 20),
      dark,
      base,
      0,
      0.07,
      0,
    );
    // Springs distinguish the launch pads; acceleration strips stay low and flat.
    if (!boostPad) {
      const springPoints = Array.from({ length: 41 }, (_, index) => {
        const fraction = index / 40;
        return new THREE.Vector3(
          Math.cos(fraction * Math.PI * 8) * radius * 0.28,
          0.13 + fraction * 0.27,
          Math.sin(fraction * Math.PI * 8) * radius * 0.28,
        );
      });
      mesh(
        new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3(springPoints),
          40,
          0.035,
          5,
          false,
        ),
        trim,
        base,
      );
    }
    moving.position.y = boostPad ? 0.145 : jumpPad ? 0.35 : 0.46;
    mesh(
      new THREE.CylinderGeometry(
        radius * 0.94,
        radius * 0.9,
        boostPad ? 0.065 : jumpPad ? 0.12 : 0.28,
        20,
      ),
      surface,
      moving,
    );
    if (boostPad) {
      for (const z of [-0.5, 0, 0.5])
        for (const side of [-1, 1]) {
          const arrow = box(
            0.14,
            0.025,
            0.6,
            trim,
            moving,
            side * 0.18,
            0.052,
            z,
          );
          arrow.rotation.y = (side * Math.PI) / 4;
          arrow.name = "duel-boost-chevron";
        }
    } else if (jumpPad) {
      const ring = mesh(
        new THREE.TorusGeometry(radius * 0.76, 0.04, 6, 28),
        trim,
        moving,
        0,
        0.085,
        0,
      );
      ring.rotation.x = Math.PI / 2;
      for (const z of [-0.18, 0.19])
        for (const side of [-1, 1]) {
          const arrow = box(
            0.075,
            0.025,
            0.36,
            trim,
            moving,
            side * 0.11,
            0.093,
            z,
          );
          arrow.rotation.y = (side * Math.PI) / 4;
        }
    } else {
      const ring = mesh(
        new THREE.TorusGeometry(radius * 0.63, 0.13, 8, 24),
        surface,
        moving,
        0,
        0.15,
        0,
      );
      ring.rotation.x = Math.PI / 2;
      mesh(
        new THREE.CylinderGeometry(radius * 0.42, radius * 0.42, 0.035, 16),
        trim,
        moving,
        0,
        0.22,
        0,
      );
    }
    const flashMaterial = new THREE.MeshBasicMaterial({
      color: boostPad ? "#d5f49f" : jumpPad ? "#a4e8ff" : "#ffd1a8",
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    owned.push(flashMaterial);
    const flash = mesh(
      new THREE.TorusGeometry(radius, 0.055, 6, 28),
      flashMaterial,
      base,
      0,
      0.1,
      0,
    );
    flash.rotation.x = Math.PI / 2;
    flash.visible = false;
    flash.castShadow = false;
    flash.receiveShadow = false;
    obstacles.set(obstacle.id, {
      obstacle,
      moving,
      surface,
      flash,
      materials: owned,
      height: moving.position.y,
      lastHit: -Infinity,
      lastVisual: -Infinity,
    });
  }

  function setRace(value, playerId) {
    race = value || null;
    lane =
      playerId && race?.hostId === playerId
        ? 0
        : playerId && race?.guestId === playerId
          ? 1
          : null;
    const visible =
      race && lane !== null && ["countdown", "racing"].includes(race.status);
    if (!visible) {
      clearObstacles();
      return;
    }
    if (layoutId === race.id) return;
    clearObstacles();
    layoutId = race.id;
    for (const obstacle of race.obstacles || []) {
      if (
        !DUEL_OBSTACLE_RULES[obstacle.kind] ||
        !Number.isFinite(obstacle.x) ||
        !Number.isFinite(obstacle.z) ||
        !(obstacle.r > 0)
      )
        continue;
      addObstacle(obstacle);
    }
  }

  function hit(position, speed, elapsed) {
    if (
      race?.status !== "racing" ||
      lane === null ||
      !Number.isFinite(speed) ||
      !Number.isFinite(elapsed)
    )
      return null;
    if (
      !position ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.z) ||
      !Number.isFinite(position.y)
    )
      return null;
    for (const record of obstacles.values()) {
      const obstacle = record.obstacle;
      const rules = DUEL_OBSTACLE_RULES[obstacle.kind];
      if (
        position.y > rules.maxTriggerHeight ||
        elapsed - record.lastHit < rules.cooldownMs / 1000
      )
        continue;
      if (
        Math.hypot(position.x - obstacle.x, position.z - obstacle.z) <=
        obstacle.r + 0.45
      )
        return obstacle;
    }
    return null;
  }

  function play(id, elapsed, remote = false, raceId = race?.id) {
    const record = obstacles.get(id);
    if (
      !record ||
      raceId !== race?.id ||
      race?.status !== "racing" ||
      !Number.isFinite(elapsed)
    )
      return false;
    const rules = DUEL_OBSTACLE_RULES[record.obstacle.kind];
    if (!remote && elapsed - record.lastHit < rules.cooldownMs / 1000)
      return false;
    if (!remote) record.lastHit = elapsed;
    record.lastVisual = elapsed;
    return true;
  }

  return {
    setRace,
    hit,
    play,
    setNight(value) {
      night = Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0;
      for (const entry of glowing)
        entry.material.emissiveIntensity = 0.025 + night * (entry.peak - 0.025);
    },
    update(dt, elapsed) {
      if (!Number.isFinite(elapsed)) return;
      for (const record of obstacles.values()) {
        const age = elapsed - record.lastVisual;
        const wave =
          age >= 0 && age < 1 ? Math.sin(age * 19) * Math.exp(-age * 4.6) : 0;
        const boost = record.obstacle.kind === "boost";
        record.moving.position.y = record.height + (boost ? 0 : wave * 0.2);
        record.moving.scale.set(
          1 + wave * (boost ? 0.04 : 0.13),
          boost ? 1 : 1 - wave * 0.28,
          1 + wave * (boost ? 0.04 : 0.13),
        );
        record.surface.emissiveIntensity =
          0.05 + night * 1.5 + Math.max(0, 1 - age / 0.55) * 0.6;
        record.flash.visible = age >= 0 && age < 0.6;
        if (record.flash.visible) {
          record.flash.scale.setScalar(1 + age * 2);
          record.flash.material.opacity = (1 - age / 0.6) * 0.8;
        }
      }
    },
  };
}
