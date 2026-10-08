import * as THREE from "three";
import {
  FUEL,
  garageSlot,
  garagePoint,
  garageLocal,
  garageWallSegments,
} from "./fuelConfig.js";

const clampTank = (value) =>
  Math.max(0, Math.min(FUEL.capacity, Number(value) || 0));

/** Predict only manual consumption; production, refilling and cargo stay authoritative. */
export function createFuelPrediction() {
  let tank = 0,
    identity = null,
    lastServerAt = -Infinity,
    clockOffset = Infinity;
  let history = [];
  return {
    get tank() {
      return tank;
    },
    reconcile(player, serverAt, now = Date.now()) {
      if (!player) {
        tank = 0;
        identity = null;
        history = [];
        lastServerAt = -Infinity;
        clockOffset = Infinity;
        return tank;
      }
      if (identity !== player.id) {
        identity = player.id;
        history = [];
        lastServerAt = -Infinity;
        clockOffset = Infinity;
      }
      const stamp = Number.isFinite(serverAt) ? serverAt : now;
      if (stamp < lastServerAt) return tank;
      clockOffset = Math.min(clockOffset, now - stamp);
      const acknowledgedAt = stamp + clockOffset;
      history = history.filter((entry) => entry.end > acknowledgedAt);
      const pending = history.reduce(
        (sum, entry) =>
          sum +
          entry.amount *
            Math.min(
              1,
              (entry.end - acknowledgedAt) /
                Math.max(1, entry.end - entry.start),
            ),
        0,
      );
      tank = clampTank(player.tank - pending);
      lastServerAt = stamp;
      return tank;
    },
    consume(dt, rate, manual, moving, now = Date.now()) {
      if (!identity || !manual || !moving || !Number.isFinite(dt) || dt <= 0)
        return false;
      const amount = Math.min(
        tank,
        Math.max(0, Number(rate) || 0) * Math.min(dt, 0.1),
      );
      if (!amount) return false;
      tank = clampTank(tank - amount);
      history.push({ start: now - dt * 1000, end: now, amount });
      history = history.filter((entry) => now - entry.end < 2000);
      return true;
    },
  };
}

export function fuelProximity(fuel, playerId, position, now = Date.now()) {
  let nearTheft = null,
    nearOwnPump = false,
    nearDoor = false;
  for (const garage of fuel?.garages || []) {
    const pump = garagePoint(garage.slot, FUEL.pumpAcross, FUEL.pumpOutward);
    const distance = Math.hypot(position.x - pump.x, position.z - pump.z);
    if (garage.ownerId === playerId) {
      nearOwnPump = distance <= FUEL.proximity;
      const close = garagePoint(
        garage.slot,
        FUEL.closeAcross,
        FUEL.closeOutward,
      );
      nearDoor =
        Math.hypot(position.x - close.x, position.z - close.z) <=
        FUEL.closeRadius;
    } else if (
      distance <= FUEL.proximity &&
      (!nearTheft || distance < nearTheft.distance)
    ) {
      nearTheft = {
        ownerId: garage.ownerId,
        nickname: garage.nickname,
        stored: garage.stored,
        closed: garage.closedUntil > now,
        distance,
      };
    }
  }
  return { nearTheft, nearOwnPump, nearDoor };
}

/** Free only a currently occupied garage's approach, preserving the rest of the grove. */
export function blocksGarageApproach(collider, garages) {
  if (!collider.model) return false;
  return garages.some((garage) => {
    const local = garageLocal(garage.slot, collider.x, collider.z);
    return (
      Math.hypot(local.across, local.outward) <
        FUEL.padRadius + collider.r + 0.7 ||
      (Math.abs(local.across) < FUEL.bridgeHalfWidth + collider.r + 0.7 &&
        local.outward > FUEL.bridgeStart - FUEL.radius - 1.6 - collider.r &&
        local.outward < 0)
    );
  });
}

export function createFuelWorld(scene) {
  const garageScale = FUEL.padRadius / 2.7;
  const root = new THREE.Group();
  root.name = "personal-garages";
  scene.add(root);
  const geometries = new Set(),
    materials = new Set(),
    textures = new Set();
  const material = (color, extra = {}) => {
    const value = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.86,
      ...extra,
    });
    materials.add(value);
    return value;
  };
  const floor = material("#d8d2b7"),
    timber = material("#c5ba92"),
    roof = material("#6b8267");
  const metal = material("#697366"),
    oil = material("#d0bf48"),
    band = material("#57694a");
  const padMaterial = material("#b1cb82", {
    emissive: "#788944",
    emissiveIntensity: 0.3,
  });
  const rimLight = material("#c5e0d0", {
      emissive: "#a8ead9",
      emissiveIntensity: 0.08,
      roughness: 0.48,
    }),
    warmLight = material("#e7d49c", {
      emissive: "#ffe0a0",
      emissiveIntensity: 0.12,
      roughness: 0.48,
    }),
    laserLight = material("#ffd1bb", {
      emissive: "#ff8e76",
      emissiveIntensity: 3.6,
      roughness: 0.4,
    });
  const box = new THREE.BoxGeometry(1, 1, 1),
    barrel = new THREE.CylinderGeometry(0.35, 0.35, 0.7, 12);
  const platform = new THREE.CylinderGeometry(
    FUEL.padRadius,
    FUEL.padRadius,
    0.24 * garageScale,
    32,
  );
  const ring = new THREE.TorusGeometry(0.355, 0.036, 5, 12);
  [box, barrel, platform, ring].forEach((geometry) => geometries.add(geometry));
  const garages = new Map(),
    cargos = new Map(),
    drops = new Map();
  let current = { garages: [], players: [], drops: [] },
    localId = null,
    disposed = false;
  function mesh(parent, geometry, mat, x, y, z, sx = 1, sy = 1, sz = 1) {
    const value = new THREE.Mesh(geometry, mat);
    value.position.set(x, y, z);
    value.scale.set(sx, sy, sz);
    value.castShadow = value.receiveShadow = true;
    parent.add(value);
    return value;
  }
  function makeBarrel(parent, scale = 1) {
    const group = new THREE.Group();
    group.scale.setScalar(scale);
    parent.add(group);
    mesh(group, barrel, oil, 0, 0.35, 0);
    for (const y of [0.12, 0.57]) {
      const rim = mesh(group, ring, band, 0, y, 0);
      rim.rotation.x = Math.PI / 2;
    }
    mesh(group, box, band, 0, 0.712, 0, 0.18, 0.022, 0.18);
    return group;
  }
  function makeSign(parent) {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 312;
    const context = canvas.getContext("2d");
    if (!context) return null;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    textures.add(texture);
    const mat = new THREE.SpriteMaterial({
      map: texture,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    materials.add(mat);
    const sprite = new THREE.Sprite(mat);
    sprite.name = "garage-fuel-sign";
    sprite.scale.set(5.2, (5.2 * canvas.height) / canvas.width, 1);
    // Keep the billboard above the pump and toward the entrance, away from the
    // elevated racing rail. An opaque face protects the text from its glow.
    sprite.position.set(-FUEL.pumpAcross, 3.25, -0.3);
    sprite.renderOrder = 30;
    parent.add(sprite);
    return { canvas, context, texture, mat, sprite, key: "" };
  }
  function buildGarage(garage) {
    const group = new THREE.Group(),
      slot = garageSlot(garage.slot);
    group.name = `personal-garage-${garage.ownerId}`;
    group.position.set(slot.x, 0, slot.z);
    group.rotation.y = Math.PI / 2 - slot.angle;
    root.add(group);
    mesh(group, platform, floor, 0, -0.12 * garageScale, 0).name =
      "garage-floor";
    mesh(
      group,
      box,
      floor,
      0,
      -0.1 * garageScale,
      (FUEL.bridgeStart - FUEL.radius) / 2,
      FUEL.bridgeHalfWidth * 2,
      0.2 * garageScale,
      FUEL.radius - FUEL.bridgeStart,
    );
    // Use the authoritative perimeter for both the curved rim and bridge rails.
    // One instanced draw per occupied garage keeps ten complete walls inexpensive.
    const segments = garageWallSegments(garage.slot);
    const walls = new THREE.InstancedMesh(box, timber, segments.length);
    walls.name = "garage-boundary-walls";
    walls.castShadow = walls.receiveShadow = true;
    const rimLights = new THREE.InstancedMesh(box, rimLight, segments.length);
    rimLights.name = "garage-rim-lights";
    // Narrow luminous caps follow the actual walls, leaving the entrance clear.
    // Their shared material provides bloom without a point light for every plot.
    const placement = new THREE.Object3D();
    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index];
      const a = garageLocal(garage.slot, segment.ax, segment.az);
      const b = garageLocal(garage.slot, segment.bx, segment.bz);
      const dx = -(b.across - a.across),
        dz = b.outward - a.outward;
      placement.position.set(
        -(a.across + b.across) / 2,
        FUEL.wallHeight / 2,
        (a.outward + b.outward) / 2,
      );
      placement.rotation.set(0, -Math.atan2(dz, dx), 0);
      placement.scale.set(
        Math.hypot(dx, dz) + 0.01,
        FUEL.wallHeight,
        FUEL.wallThickness,
      );
      placement.updateMatrix();
      walls.setMatrixAt(index, placement.matrix);
      placement.position.y = FUEL.wallHeight + 0.022;
      placement.scale.y = 0.045;
      placement.scale.z = 0.07;
      placement.updateMatrix();
      rimLights.setMatrixAt(index, placement.matrix);
    }
    walls.instanceMatrix.needsUpdate = true;
    walls.computeBoundingSphere();
    rimLights.instanceMatrix.needsUpdate = true;
    rimLights.computeBoundingSphere();
    group.add(walls, rimLights);
    const canopy = mesh(
      group,
      box,
      roof,
      0,
      1.2 * garageScale,
      2.12 * garageScale,
      2.1 * garageScale,
      0.18 * garageScale,
      0.78 * garageScale,
    );
    canopy.name = "garage-canopy";
    canopy.rotation.x = -0.1;
    const canopyLights = new THREE.Group();
    canopyLights.name = "garage-canopy-lights";
    canopyLights.position.copy(canopy.position);
    canopyLights.rotation.copy(canopy.rotation);
    group.add(canopyLights);
    for (const side of [-1, 1]) {
      const trim = mesh(
        canopyLights,
        box,
        warmLight,
        0,
        0,
        side * 0.395 * garageScale,
        2.1 * garageScale,
        0.04 * garageScale,
        0.035 * garageScale,
      );
      trim.castShadow = trim.receiveShadow = false;
    }
    const gate = new THREE.Group();
    gate.name = "garage-door";
    gate.position.z = FUEL.gateOutward;
    gate.visible = false;
    group.add(gate);
    for (const [index, height] of [0.25, 0.65, 1.05].entries()) {
      const beam = mesh(
        gate,
        box,
        laserLight,
        0,
        height * garageScale,
        0,
        FUEL.gateHalfWidth * 2,
        0.045 * garageScale,
        0.045 * garageScale,
      );
      beam.name = `garage-door-laser-${index + 1}`;
      beam.castShadow = beam.receiveShadow = false;
    }
    const gatePosts = [-FUEL.gateHalfWidth, FUEL.gateHalfWidth];
    for (const x of gatePosts)
      mesh(
        group,
        box,
        metal,
        x,
        0.6 * garageScale,
        FUEL.gateOutward,
        0.12 * garageScale,
        1.2 * garageScale,
        0.14 * garageScale,
      );
    const pump = makeBarrel(group, 1.28 * garageScale);
    pump.name = "garage-pump";
    pump.position.set(-FUEL.pumpAcross, 0, FUEL.pumpOutward);
    const pumpLight = mesh(pump, ring, warmLight, 0, 0.64, 0, 0.97, 0.97, 0.7);
    pumpLight.name = "garage-pump-light";
    pumpLight.rotation.x = Math.PI / 2;
    pumpLight.castShadow = pumpLight.receiveShadow = false;
    mesh(
      group,
      box,
      metal,
      -0.42 * garageScale,
      0.7 * garageScale,
      FUEL.pumpOutward,
      0.12 * garageScale,
      0.13 * garageScale,
      0.48 * garageScale,
    );
    const pad = mesh(
      group,
      box,
      padMaterial,
      -FUEL.closeAcross,
      0.02 * garageScale,
      FUEL.closeOutward,
      1.04 * garageScale,
      0.06 * garageScale,
      0.58 * garageScale,
    );
    pad.name = "garage-close-pad";
    const sign = makeSign(group);
    return { group, walls, rimLights, gate, pad, sign, slot: garage.slot };
  }
  function removeGarage(entry) {
    root.remove(entry.group);
    entry.walls.dispose();
    entry.rimLights.dispose();
    if (entry.sign) {
      entry.sign.texture.dispose();
      textures.delete(entry.sign.texture);
      entry.sign.mat.dispose();
      materials.delete(entry.sign.mat);
    }
  }
  function setFuel(value, playerId) {
    if (disposed) return;
    current = value || { garages: [], players: [], drops: [] };
    localId = playerId;
    const ids = new Set(
      (current.garages || []).map((garage) => garage.ownerId),
    );
    for (const [id, entry] of garages)
      if (!ids.has(id)) {
        removeGarage(entry);
        garages.delete(id);
      }
    for (const garage of current.garages || []) {
      let entry = garages.get(garage.ownerId);
      if (entry && entry.slot !== garage.slot) {
        removeGarage(entry);
        garages.delete(garage.ownerId);
        entry = null;
      }
      if (!entry) garages.set(garage.ownerId, buildGarage(garage));
    }
    const dropIds = new Set((current.drops || []).map((drop) => drop.id));
    for (const [id, group] of drops)
      if (!dropIds.has(id)) {
        root.remove(group);
        drops.delete(id);
      }
    for (const drop of current.drops || []) {
      if (!drops.has(drop.id)) drops.set(drop.id, makeBarrel(root, 0.9));
      drops.get(drop.id).position.set(drop.x, 0.04, drop.z);
    }
  }
  function update(now, cars, night = 0) {
    if (disposed) return;
    const darkness = Math.max(0, Math.min(1, night));
    padMaterial.emissiveIntensity = 0.2 + darkness * 0.55;
    rimLight.emissiveIntensity = 0.08 + darkness * 2.22;
    warmLight.emissiveIntensity = 0.12 + darkness * 2.53;
    laserLight.emissiveIntensity = 3.6 + darkness * 0.6;
    for (const garage of current.garages || []) {
      const entry = garages.get(garage.ownerId);
      if (!entry) continue;
      const seconds = Math.max(0, Math.ceil((garage.closedUntil - now) / 1000));
      entry.gate.visible = garage.closedUntil > now;
      entry.pad.visible = garage.ownerId === localId;
      const sign = entry.sign;
      const key = `${garage.nickname}|${Math.floor(garage.stored)}|${seconds}|${garage.ownerId === localId}`;
      if (sign && sign.key !== key) {
        sign.key = key;
        const ctx = sign.context;
        const stored = Math.max(
          0,
          Math.min(FUEL.stockCapacity, Math.floor(garage.stored)),
        );
        ctx.clearRect(0, 0, 512, 312);
        ctx.fillStyle = "#24352f";
        ctx.beginPath();
        ctx.roundRect(5, 5, 502, 302, 28);
        ctx.fill();
        ctx.strokeStyle = "#64735b";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.textAlign = "center";
        ctx.fillStyle = "#f5f1dc";
        ctx.font = "600 50px sans-serif";
        const nickname = String(garage.nickname || "친구");
        ctx.fillText(
          `${nickname.length > 9 ? nickname.slice(0, 8) + "…" : nickname}의 차고`,
          256,
          68,
          454,
        );
        ctx.textAlign = "left";
        ctx.fillStyle = "#b7c3ac";
        ctx.font = "500 29px sans-serif";
        ctx.fillText("보관 연료", 42, 114);

        // Draw the gold halo separately from the sharp numeral so bloom never
        // turns the amount into an unreadable white patch.
        ctx.textAlign = "right";
        ctx.font = "700 124px sans-serif";
        ctx.fillStyle = "#ffdc84";
        ctx.shadowColor = "rgba(255, 198, 77, 0.62)";
        ctx.shadowBlur = 18;
        ctx.fillText(String(stored), 300, 222);
        ctx.shadowBlur = 0;
        ctx.shadowColor = "transparent";
        ctx.fillText(String(stored), 300, 222);
        ctx.textAlign = "left";
        ctx.fillStyle = "#c9c7ad";
        ctx.font = "500 43px sans-serif";
        ctx.fillText(`/ ${FUEL.stockCapacity}`, 318, 218);

        ctx.fillStyle = "#465448";
        ctx.beginPath();
        ctx.roundRect(42, 241, 428, 10, 5);
        ctx.fill();
        if (stored > 0) {
          ctx.fillStyle = "#efcb77";
          ctx.beginPath();
          ctx.roundRect(42, 241, (428 * stored) / FUEL.stockCapacity, 10, 5);
          ctx.fill();
        }
        ctx.textAlign = "center";
        ctx.fillStyle = seconds ? "#efd296" : "#bcd0ac";
        ctx.font = "500 30px sans-serif";
        ctx.fillText(
          seconds ? `문 닫힘 · ${seconds}초` : "문 열림",
          256,
          288,
          448,
        );
        sign.texture.needsUpdate = true;
      }
    }
    const cargoIds = new Set();
    for (const player of current.players || []) {
      if (!player.carrying) continue;
      const car = cars?.get(player.id);
      if (!car?.visible) continue;
      cargoIds.add(player.id);
      if (!cargos.has(player.id)) cargos.set(player.id, makeBarrel(root, 0.85));
      const cargo = cargos.get(player.id);
      cargo.position.copy(car.position);
      cargo.position.y += 1.78;
      cargo.rotation.y = car.rotation.y;
    }
    for (const [id, group] of cargos)
      if (!cargoIds.has(id)) {
        root.remove(group);
        cargos.delete(id);
      }
  }
  return {
    setFuel,
    update,
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(root);
      for (const entry of garages.values()) {
        entry.walls.dispose();
        entry.rimLights.dispose();
      }
      geometries.forEach((value) => value.dispose());
      materials.forEach((value) => value.dispose());
      textures.forEach((value) => value.dispose());
      garages.clear();
      cargos.clear();
      drops.clear();
      root.clear();
    },
  };
}
