import { ITEMS } from "./cosmeticsCatalog.js";
const ITEM_BY_ID = new Map(ITEMS.map((item) => [item.id, item]));

export const FUEL = Object.freeze({
  capacity: 100,
  stockCapacity: 200,
  production: 20,
  productionIntervalMs: 60000,
  transferPerSecond: 20,
  stealAmount: 25,
  stealMs: 3000,
  proximity: 1.8,
  gateMs: 30000,
  slots: 10,
  radius: 24.5,
  padRadius: 4.05,
  bridgeStart: 20.2,
  bridgeHalfWidth: 2.55,
  gateOutward: -2.475,
  gateHalfWidth: 2.55,
  wallThickness: 0.21,
  wallHeight: 1.47,
  carRadius: 0.65,
  pumpAcross: 0,
  pumpOutward: 0.45,
  closeAcross: 1.8,
  closeOutward: -2.4,
  closeRadius: 0.975,
});

export function garageSlot(slot) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= FUEL.slots)
    throw new RangeError("Invalid garage slot");
  const angle = ((180 + (180 * slot) / (FUEL.slots - 1)) * Math.PI) / 180;
  return {
    slot,
    x: Math.cos(angle) * FUEL.radius,
    z: Math.sin(angle) * FUEL.radius,
    angle,
  };
}

export function garagePoint(slot, across = 0, outward = 0) {
  const garage = garageSlot(slot);
  return {
    x:
      garage.x +
      Math.cos(garage.angle) * outward -
      Math.sin(garage.angle) * across,
    z:
      garage.z +
      Math.sin(garage.angle) * outward +
      Math.cos(garage.angle) * across,
  };
}

export function garageLocal(slot, x, z) {
  const garage = garageSlot(slot);
  const dx = x - garage.x;
  const dz = z - garage.z;
  return {
    across: -Math.sin(garage.angle) * dx + Math.cos(garage.angle) * dz,
    outward: Math.cos(garage.angle) * dx + Math.sin(garage.angle) * dz,
  };
}

export function isGarageDriveable(x, z, slot) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  const { across, outward } = garageLocal(slot, x, z);
  return (
    Math.hypot(across, outward) <= FUEL.padRadius - FUEL.carRadius ||
    (Math.abs(across) <= FUEL.bridgeHalfWidth - FUEL.carRadius &&
      outward >= FUEL.bridgeStart - FUEL.radius &&
      outward <= 0)
  );
}

/** The gate only blocks visitors while closed; perimeter walls block everyone. */
export function garageDoorContact(previous, next, garage, playerId, time) {
  if (garage.ownerId === playerId || garage.closedUntil <= time) return null;
  const before = garageLocal(garage.slot, previous.x, previous.z);
  const after = garageLocal(garage.slot, next.x, next.z);
  const plane = FUEL.gateOutward;
  const side = before.outward >= plane ? 1 : -1;
  const limit = plane + side * FUEL.carRadius;
  if ((after.outward - limit) * side >= 0) return null;
  const delta = after.outward - before.outward;
  if (Math.abs(delta) < 1e-8) return null;
  const t = Math.max(0, Math.min(1, (limit - before.outward) / delta));
  const across = before.across + (after.across - before.across) * t;
  if (Math.abs(across) > FUEL.gateHalfWidth + FUEL.carRadius) return null;
  return garagePoint(garage.slot, across, limit);
}

const wallCache = new Map();
/** One shared perimeter for rendering, navigation and swept collision checks. */
export function garageWallSegments(slot) {
  if (wallCache.has(slot)) return wallCache.get(slot);
  const radius = FUEL.padRadius - FUEL.wallThickness / 2;
  const join = -Math.sqrt(radius ** 2 - FUEL.bridgeHalfWidth ** 2);
  const endAngle = Math.acos(join / radius);
  const segments = [];
  const add = (a, b) => {
    const from = garagePoint(slot, a.x, a.z);
    const to = garagePoint(slot, b.x, b.z);
    segments.push(
      Object.freeze({ ax: from.x, az: from.z, bx: to.x, bz: to.z }),
    );
  };
  for (let index = 0; index < 64; index++) {
    const a = -endAngle + (2 * endAngle * index) / 64;
    const b = -endAngle + (2 * endAngle * (index + 1)) / 64;
    add(
      { x: Math.sin(a) * radius, z: Math.cos(a) * radius },
      { x: Math.sin(b) * radius, z: Math.cos(b) * radius },
    );
  }
  for (const side of [-1, 1])
    add(
      { x: side * FUEL.bridgeHalfWidth, z: join },
      { x: side * FUEL.bridgeHalfWidth, z: FUEL.bridgeStart - FUEL.radius },
    );
  const result = Object.freeze(segments);
  wallCache.set(slot, result);
  return result;
}

/** Sweep a car disk against wall capsules so fast impacts cannot cross the rim. */
export function garageWallContact(from, to, garage) {
  if (![from?.x, from?.z, to?.x, to?.z].every(Number.isFinite)) return null;
  const dx = to.x - from.x,
    dz = to.z - from.z;
  const length2 = dx * dx + dz * dz;
  if (length2 < 1e-12) return null;
  const radius = FUEL.carRadius + FUEL.wallThickness / 2;
  let first = null;
  const add = (t, nx, nz, x = from.x + dx * t, z = from.z + dz * t) => {
    if (
      t < -1e-8 ||
      t > 1 ||
      dx * nx + dz * nz >= -1e-9 ||
      (first && t >= first.t)
    )
      return;
    first = {
      t: Math.max(0, t),
      x: x + nx * 0.005,
      z: z + nz * 0.005,
      nx,
      nz,
      kind: "wall",
    };
  };
  for (const wall of garageWallSegments(garage.slot)) {
    const ex = wall.bx - wall.ax,
      ez = wall.bz - wall.az;
    const length = Math.hypot(ex, ez),
      tx = ex / length,
      tz = ez / length;
    const nx = -tz,
      nz = tx;
    const ox = from.x - wall.ax,
      oz = from.z - wall.az;
    const distance = ox * nx + oz * nz;
    const across = ox * tx + oz * tz;
    const velocity = dx * nx + dz * nz;
    if (Math.abs(distance) < radius && across >= 0 && across <= length) {
      const side = distance >= 0 ? 1 : -1;
      add(
        0,
        nx * side,
        nz * side,
        from.x + nx * (side * radius - distance),
        from.z + nz * (side * radius - distance),
      );
    }
    if (Math.abs(velocity) > 1e-12)
      for (const side of [-1, 1]) {
        const t = (side * radius - distance) / velocity;
        const projection = across + (dx * tx + dz * tz) * t;
        if (projection >= 0 && projection <= length)
          add(t, nx * side, nz * side);
      }
    for (const [x, z] of [
      [wall.ax, wall.az],
      [wall.bx, wall.bz],
    ]) {
      const fx = from.x - x,
        fz = from.z - z;
      const b = fx * dx + fz * dz,
        c = fx * fx + fz * fz - radius * radius;
      const discriminant = b * b - length2 * c;
      if (discriminant < 0) continue;
      const t = c <= 0 ? 0 : (-b - Math.sqrt(discriminant)) / length2;
      const px = fx + dx * t,
        pz = fz + dz * t,
        distance = Math.hypot(px, pz);
      if (distance > 1e-9)
        add(
          t,
          px / distance,
          pz / distance,
          x + (px / distance) * radius,
          z + (pz / distance) * radius,
        );
    }
  }
  return first;
}

const rarityRates = {
  common: 1,
  rare: 0.94,
  epic: 0.87,
  legendary: 0.8,
  mythic: 0.72,
};
const bodyRates = {
  jeep: 1,
  buggy: 0.9,
  van: 1.12,
  sport: 1.08,
  pickup: 1.1,
  roadster: 0.94,
  rally: 1.04,
  muscle: 1.12,
  formula: 1.08,
  monster: 1.18,
  apex: 1.04,
  venom: 1.12,
  "aurora-gt": 0.97,
  solstice: 0.94,
  phantom: 1.02,
  motorbike: 0.82,
  wedge: 1.14,
  limousine: 1.16,
};

export function getFuelEconomy(bodyId) {
  const item = ITEM_BY_ID.get(bodyId);
  const body = item?.type === "body" ? item : null;
  const consumptionRate =
    Math.round(
      10 *
        (rarityRates[body?.rarity] || 1) *
        (bodyRates[body?.style] || 1) *
        100,
    ) / 100;
  return {
    tankCapacity: FUEL.capacity,
    consumptionRate,
    boostSeconds: FUEL.capacity / consumptionRate,
    efficiency: 10 / consumptionRate,
    rarity: body?.rarity || "common",
    style: body?.style || "jeep",
  };
}
