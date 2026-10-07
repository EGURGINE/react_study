import { ITEMS } from "./cosmeticsCatalog.js";
// Shared by the renderer and authoritative game server. Coins have no cash value.
export const LAP_REWARD = 20;
export const CRATE_COST = 100;
export const STARTER_COINS = 0;
export const DUPLICATE_REFUND = 40;
export const RARITIES = Object.freeze([
  { id: "common", label: "커먼", color: "#ffffff", weight: 74.5 },
  { id: "rare", label: "레어", color: "#4c95ef", weight: 20 },
  { id: "epic", label: "에픽", color: "#a468e2", weight: 4 },
  { id: "legendary", label: "레전더리", color: "#f6c845", weight: 1 },
  { id: "mythic", label: "신화", color: "#ff718f", weight: 0.5 },
]);
export const STARTER_EQUIPPED = Object.freeze({
  body: "body-starter",
  trail: "trail-none",
  spray: "spray-wave",
});
export { ITEMS };
export const ITEM_BY_ID = new Map(ITEMS.map((item) => [item.id, item]));
export const TRACK = Object.freeze({
  cx: 0,
  cz: 34,
  halfStraight: 12,
  radius: 5,
  halfWidth: 2,
});
export const TRACK_LENGTH = 4 * TRACK.halfStraight + 2 * Math.PI * TRACK.radius;
// Keep the entire entrance clear and make its physical and rendered widths agree.
export const CONNECTOR = Object.freeze({
  halfWidth: 4.5,
  startZ: 18,
  endZ: 29,
});
export const DUEL_TRACK = Object.freeze({
  cx: 0,
  cz: 10,
  radius: 32,
  halfStraight: 8,
  halfWidth: 3.2,
  laneOffset: 1.25,
});
export const DUEL_LENGTH =
  4 * DUEL_TRACK.halfStraight + 2 * Math.PI * DUEL_TRACK.radius;

/** One forward lap around the island; positive lateral offsets face outward. */
export function duelPoint(progress, lateralOffset = 0) {
  let distance = wrap(progress) * DUEL_LENGTH;
  const { cx, cz, halfStraight: h, radius: centerRadius } = DUEL_TRACK;
  const radius = centerRadius + lateralOffset;
  if (distance <= h)
    return { x: cx - radius, z: cz - distance, heading: Math.PI };
  distance -= h;
  if (distance <= Math.PI * centerRadius) {
    const angle = Math.PI + distance / centerRadius;
    return {
      x: cx + radius * Math.cos(angle),
      z: cz - h + radius * Math.sin(angle),
      heading: -angle,
    };
  }
  distance -= Math.PI * centerRadius;
  if (distance <= 2 * h)
    return { x: cx + radius, z: cz - h + distance, heading: 0 };
  distance -= 2 * h;
  if (distance <= Math.PI * centerRadius) {
    const angle = distance / centerRadius;
    return {
      x: cx + radius * Math.cos(angle),
      z: cz + h + radius * Math.sin(angle),
      heading: -angle,
    };
  }
  distance -= Math.PI * centerRadius;
  return { x: cx - radius, z: cz + h - distance, heading: Math.PI };
}
export function duelStart(lane = 0) {
  return duelPoint(0, (lane === 1 ? 1 : -1) * DUEL_TRACK.laneOffset);
}
export function projectDuel(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z))
    return {
      x: 0,
      z: DUEL_TRACK.cz,
      heading: 0,
      progress: 0,
      distance: Infinity,
      lateralOffset: 0,
      inside: false,
    };
  const { cx, cz, radius: r, halfStraight: h, halfWidth } = DUEL_TRACK;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const straightZ = clamp(z, cz - h, cz + h);
  let topAngle = Math.atan2(z - (cz - h), x - cx);
  if (topAngle < 0) topAngle += 2 * Math.PI;
  topAngle = clamp(topAngle, Math.PI, 2 * Math.PI);
  const bottomAngle = clamp(Math.atan2(z - (cz + h), x - cx), 0, Math.PI);
  const candidates = [
    {
      x: cx - r,
      z: straightZ,
      s: straightZ <= cz ? cz - straightZ : DUEL_LENGTH - (straightZ - cz),
    },
    { x: cx + r, z: straightZ, s: h + Math.PI * r + straightZ - (cz - h) },
    {
      x: cx + r * Math.cos(topAngle),
      z: cz - h + r * Math.sin(topAngle),
      s: h + (topAngle - Math.PI) * r,
    },
    {
      x: cx + r * Math.cos(bottomAngle),
      z: cz + h + r * Math.sin(bottomAngle),
      s: 3 * h + Math.PI * r + bottomAngle * r,
    },
  ];
  const nearest = candidates.reduce((best, point) =>
    Math.hypot(x - point.x, z - point.z) < Math.hypot(x - best.x, z - best.z)
      ? point
      : best,
  );
  const progress = wrap(nearest.s / DUEL_LENGTH);
  const heading = duelPoint(progress).heading;
  const distance = Math.hypot(x - nearest.x, z - nearest.z);
  return {
    x: nearest.x,
    z: nearest.z,
    heading,
    progress,
    distance,
    lateralOffset:
      (x - nearest.x) * Math.cos(heading) - (z - nearest.z) * Math.sin(heading),
    inside: distance <= halfWidth + 1e-8,
  };
}
const wrap = (value) => ((value % 1) + 1) % 1;
export function trackPoint(progress) {
  let distance = wrap(progress) * TRACK_LENGTH;
  const { halfStraight: h, radius: r, cz } = TRACK;
  if (distance <= h) return { x: distance, z: cz - r, heading: Math.PI / 2 };
  distance -= h;
  if (distance <= Math.PI * r) {
    const angle = -Math.PI / 2 + distance / r;
    return {
      x: h + r * Math.cos(angle),
      z: cz + r * Math.sin(angle),
      heading: -angle,
    };
  }
  distance -= Math.PI * r;
  if (distance <= 2 * h)
    return { x: h - distance, z: cz + r, heading: -Math.PI / 2 };
  distance -= 2 * h;
  if (distance <= Math.PI * r) {
    const angle = Math.PI / 2 + distance / r;
    return {
      x: -h + r * Math.cos(angle),
      z: cz + r * Math.sin(angle),
      heading: -angle,
    };
  }
  distance -= Math.PI * r;
  return { x: -h + distance, z: cz - r, heading: Math.PI / 2 };
}
export function projectTrack(x, z) {
  const { halfStraight: h, radius: r, cz } = TRACK;
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const tx = clamp(x, -h, h);
  const right = clamp(Math.atan2(z - cz, x - h), -Math.PI / 2, Math.PI / 2);
  let left = Math.atan2(z - cz, x + h);
  if (left < 0) left += Math.PI * 2;
  left = clamp(left, Math.PI / 2, Math.PI * 1.5);
  const candidates = [
    { x: tx, z: cz - r, s: tx >= 0 ? tx : TRACK_LENGTH + tx },
    { x: tx, z: cz + r, s: h + Math.PI * r + (h - tx) },
    {
      x: h + r * Math.cos(right),
      z: cz + r * Math.sin(right),
      s: h + (right + Math.PI / 2) * r,
    },
    {
      x: -h + r * Math.cos(left),
      z: cz + r * Math.sin(left),
      s: 3 * h + Math.PI * r + (left - Math.PI / 2) * r,
    },
  ];
  const nearest = candidates.reduce((best, p) =>
    Math.hypot(x - p.x, z - p.z) < Math.hypot(x - best.x, z - best.z)
      ? p
      : best,
  );
  return {
    x: nearest.x,
    z: nearest.z,
    progress: wrap(nearest.s / TRACK_LENGTH),
    distance: Math.hypot(x - nearest.x, z - nearest.z),
  };
}
export function isDriveable(x, z) {
  return (
    Number.isFinite(x) &&
    Number.isFinite(z) &&
    (Math.hypot(x, z) <= 21.3 ||
      (Math.abs(x) <= CONNECTOR.halfWidth &&
        z >= CONNECTOR.startZ &&
        z <= CONNECTOR.endZ) ||
      projectTrack(x, z).distance <= TRACK.halfWidth ||
      projectDuel(x, z).inside)
  );
}

/** Face back into the current road after an edge hit, including reversing. */
export function recoveryHeading(x, z, movementSign = 1) {
  let aim = { x: 0, z: 0 };
  const duel = projectDuel(x, z);
  if (duel.inside) {
    aim = duel.distance > 0.2 ? duel : duelPoint(duel.progress + 0.005);
  } else if (
    Math.abs(x) <= CONNECTOR.halfWidth &&
    z >= CONNECTOR.startZ &&
    z <= CONNECTOR.endZ
  ) {
    aim = { x: 0, z: (CONNECTOR.startZ + CONNECTOR.endZ) / 2 };
  } else {
    const projected = projectTrack(x, z);
    if (projected.distance <= TRACK.halfWidth + 0.01)
      aim =
        projected.distance > 0.2
          ? projected
          : trackPoint(projected.progress + 0.02);
  }
  return Math.atan2(aim.x - x, aim.z - z) + (movementSign < 0 ? Math.PI : 0);
}
