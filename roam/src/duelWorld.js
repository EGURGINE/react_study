import * as THREE from "three";
import { DUEL_TRACK, DUEL_LENGTH } from "./gameConfig.js";
import { DUEL_OBSTACLE_RULES } from "./duelObstacles.js";

/** The duel course is a separate two-lane sprint. All meshes are scene-owned
 * and intentionally have no connection or collision shortcut to the island. */
export function createDuelWorld(scene) {
  const root = new THREE.Group();
  root.name = "duel-sprint-course";
  scene.add(root);
  const { cx, startZ, finishZ, halfWidth, endPadding, laneOffset } = DUEL_TRACK;
  const nearZ = startZ + endPadding;
  const farZ = finishZ - endPadding;
  const centerZ = (nearZ + farZ) / 2;
  const length = nearZ - farZ;
  const glowing = [];
  const materials = new Map();
  const obstacleRoot = new THREE.Group();
  obstacleRoot.name = "duel-race-obstacles";
  root.add(obstacleRoot);
  const obstacles = new Map();
  let race = null;
  let lane = null;
  let layoutId = null;
  let night = 0;
  function mat(color) {
    if (!materials.has(color))
      materials.set(
        color,
        new THREE.MeshStandardMaterial({ color, roughness: 0.84 }),
      );
    return materials.get(color);
  }
  function neon(dayColor, lightColor, peak) {
    const material = new THREE.MeshStandardMaterial({
      color: dayColor,
      emissive: lightColor,
      emissiveIntensity: 0.025,
      roughness: 0.6,
    });
    glowing.push({ material, peak });
    return material;
  }
  const cyan = neon("#c1dad1", "#85e5ff", 3.3);
  const violet = neon("#d5cadd", "#c7a3ff", 4.1);
  const white = neon("#f7efd5", "#e7f1ff", 2.65);
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
  for (const side of [-1, 1]) {
    const pipeX = cx + (side * halfWidth) / 2;
    const curve = new THREE.LineCurve3(
      new THREE.Vector3(pipeX, -1.66, farZ),
      new THREE.Vector3(pipeX, -1.66, nearZ),
    );
    mesh(
      new THREE.TubeGeometry(curve, 1, 1.63, 14, false),
      side < 0 ? "#a9c2b2" : "#c0b7cf",
    );
    for (const z of [nearZ, farZ]) {
      mesh(
        new THREE.CircleGeometry(1.63, 14),
        new THREE.MeshStandardMaterial({
          color: side < 0 ? "#a9c2b2" : "#c0b7cf",
          roughness: 0.9,
          side: THREE.DoubleSide,
        }),
        root,
        pipeX,
        -1.66,
        z,
      );
    }
    box(
      0.12,
      0.09,
      length,
      side < 0 ? cyan : violet,
      root,
      cx + side * (halfWidth - 0.025),
      0.075,
      centerZ,
    );
  }
  box(halfWidth * 2, 0.14, length, "#e5e0c1", root, cx, -0.055, centerZ);
  for (const side of [-1, 1]) {
    box(
      halfWidth - 0.2,
      0.012,
      length - 0.18,
      side < 0 ? "#d9e2c9" : "#e4d9d9",
      root,
      cx + (side * halfWidth) / 2,
      0.022,
      centerZ,
    );
  }
  for (let z = farZ + 0.6; z < nearZ; z += 1.5)
    box(0.075, 0.022, 0.65, "#b2b397", root, cx, 0.04, z);
  for (const z of [startZ, finishZ]) {
    for (let x = 0; x < 16; x++)
      for (let row = 0; row < 2; row++) {
        box(
          0.38,
          0.027,
          0.28,
          (x + row) % 2 ? white : "#506753",
          root,
          cx - 2.85 + x * 0.38,
          0.055,
          z + (row ? 0.14 : -0.14),
        );
      }
  }
  for (const side of [-1, 1]) {
    for (const z of [10, 1, -8, -17]) {
      const arrow = new THREE.Group();
      arrow.position.set(cx + side * laneOffset, 0.055, z);
      arrow.rotation.y = Math.PI;
      root.add(arrow);
      for (const armSide of [-1, 1]) {
        const arm = box(
          0.16,
          0.025,
          0.82,
          side < 0 ? cyan : violet,
          arrow,
          armSide * 0.265,
          0,
          0,
        );
        arm.rotation.y = (-armSide * Math.PI) / 4;
      }
    }
    for (const z of [nearZ - 1, 6, -10, farZ + 1]) {
      mesh(
        new THREE.CylinderGeometry(0.23, 0.34, 1.6, 8),
        "#8fa085",
        root,
        cx + side * 2,
        -3.2,
        z,
      );
      box(1.15, 0.15, 1.1, "#b2b79c", root, cx + side * 2, -4.05, z);
    }
  }
  function label(text, sub, x, y, z, width, height, floor = false) {
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
    glowing.push({ material, peak: 0.8 });
    const plane = mesh(
      new THREE.PlaneGeometry(width, height),
      material,
      root,
      x,
      y,
      z,
    );
    if (floor) plane.rotation.x = -Math.PI / 2;
    return plane;
  }
  for (const [z, text, light] of [
    [startZ, "1 VS 1", cyan],
    [finishZ, "FINISH", violet],
  ]) {
    for (const side of [-1, 1]) {
      mesh(
        new THREE.CylinderGeometry(0.12, 0.15, 3.8, 10),
        "#8b9f83",
        root,
        cx + side * (halfWidth + 0.3),
        1.9,
        z,
      );
      box(
        0.07,
        2.6,
        0.06,
        light,
        root,
        cx + side * (halfWidth + 0.3),
        2,
        z + 0.16,
      );
      box(
        0.48,
        0.16,
        0.48,
        "#bfc5a5",
        root,
        cx + side * (halfWidth + 0.3),
        0.08,
        z,
      );
    }
    box(halfWidth * 2 + 0.8, 0.18, 0.17, "#8b9f83", root, cx, 3.74, z);
    box(halfWidth * 2 + 0.7, 0.065, 0.05, light, root, cx, 3.77, z + 0.13);
    label(
      text,
      z === startZ
        ? `${DUEL_LENGTH} M · FIRST TO THE LINE`
        : "A GOOD RACE, A GOOD FRIEND",
      cx,
      3.28,
      z + 0.14,
      5.8,
      0.95,
    );
  }
  label("01", "", cx - laneOffset, 0.059, startZ + 1.35, 1.1, 0.9, true);
  label("02", "", cx + laneOffset, 0.059, startZ + 1.35, 1.1, 0.9, true);
  for (const distance of [14, 28])
    label(`${distance} M`, "", cx, 0.062, startZ - distance, 0.8, 0.65, true);
  // Low end caps identify the recovery margin without placing a wall on the lane.
  for (const z of [nearZ + 0.12, farZ - 0.12])
    box(halfWidth * 2, 0.18, 0.16, "#c4bea3", root, cx, -0.02, z);

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
    const trim = paint("#f2ecd4");
    const dark = paint(jumpPad ? "#528b9e" : "#a46455");
    const surface = paint(jumpPad ? "#97d7e1" : "#efa485", true);
    const radius = obstacle.r;
    mesh(
      new THREE.CylinderGeometry(radius, radius + 0.06, 0.1, 20),
      dark,
      base,
      0,
      0.07,
      0,
    );
    // A visible spring makes the two interactive objects distinct from road markings.
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
    moving.position.y = jumpPad ? 0.35 : 0.46;
    mesh(
      new THREE.CylinderGeometry(
        radius * 0.94,
        radius * 0.9,
        jumpPad ? 0.12 : 0.28,
        20,
      ),
      surface,
      moving,
    );
    if (jumpPad) {
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
      color: jumpPad ? "#a4e8ff" : "#ffd1a8",
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
        record.moving.position.y = record.height + wave * 0.2;
        record.moving.scale.set(
          1 + wave * 0.13,
          1 - wave * 0.28,
          1 + wave * 0.13,
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
