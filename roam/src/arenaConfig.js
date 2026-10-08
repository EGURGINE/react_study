const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const ARENA = Object.freeze({
  // Keep the expanded stands clear of the western racing road.
  cx: -70,
  cz: 9,
  minPlayers: 2,
  maxPlayers: 10,
  stake: 20,
  maxSpeed: 40,
  carRadius: 0.65,
  guardHeight: 2,
  guardThickness: 0.16,
  minRadius: 15,
  maxRadius: 27,
  spawnClearance: 3,
});
export const ARENA_OBSTACLE_RULES = Object.freeze({
  jump: Object.freeze({
    r: 0.95,
    cooldownMs: 1800,
    maxTriggerHeight: 0.6,
    jumpVelocity: 9.6,
    kick: 0,
  }),
  bounce: Object.freeze({
    r: 0.8,
    cooldownMs: 1400,
    maxTriggerHeight: 0.6,
    jumpVelocity: 3.2,
    kick: 16,
    speed: 16,
  }),
  boost: Object.freeze({
    r: 1.05,
    cooldownMs: 1700,
    maxTriggerHeight: 0.6,
    jumpVelocity: 0,
    kick: 20,
    speed: 20,
    duration: 1.5,
  }),
});

export function arenaRadius(count) {
  const total = clamp(
    Math.floor(Number(count) || ARENA.minPlayers),
    ARENA.minPlayers,
    ARENA.maxPlayers,
  );
  const progress =
    (total - ARENA.minPlayers) / (ARENA.maxPlayers - ARENA.minPlayers);
  return ARENA.minRadius + (ARENA.maxRadius - ARENA.minRadius) * progress;
}

export function arenaSpawn(index, count, radius = arenaRadius(count)) {
  const total = clamp(
    Math.floor(Number(count) || ARENA.minPlayers),
    ARENA.minPlayers,
    ARENA.maxPlayers,
  );
  const angle =
    ((((index % total) + total) % total) * TAU) / total - Math.PI / 2;
  const distance =
    clamp(radius, ARENA.minRadius, ARENA.maxRadius) - ARENA.spawnClearance;
  return {
    x: ARENA.cx + Math.cos(angle) * distance,
    z: ARENA.cz + Math.sin(angle) * distance,
    y: 0,
    heading: Math.atan2(-Math.cos(angle), -Math.sin(angle)),
  };
}

/** Randomness is consumed only by the server; clients receive the whole layout. */
export function createArenaLayout(count, random = Math.random) {
  const radius = arenaRadius(count);
  const total = clamp(
    Math.floor(Number(count) || ARENA.minPlayers),
    ARENA.minPlayers,
    ARENA.maxPlayers,
  );
  const next = () => clamp(Number(random()) || 0, 0, 0.999999999);
  const rotation = next() * TAU;
  const guards = Array.from({ length: 4 }, (_, index) => ({
    id: `arena-guard-${index}`,
    angle: rotation + (index * TAU) / 4,
    halfAngle: (TAU * 0.3) / 8,
  }));
  const spawns = Array.from({ length: total }, (_, index) =>
    arenaSpawn(index, total, radius),
  );
  const obstacles = [];
  const wanted = 6 + Math.floor(total / 2);
  const kinds = ["jump", "bounce", "boost"];
  for (let attempt = 0; attempt < 500 && obstacles.length < wanted; attempt++) {
    const kind = kinds[obstacles.length % kinds.length];
    const r = ARENA_OBSTACLE_RULES[kind].r;
    // The golden-angle fallback keeps even a constant test RNG well distributed.
    const angle = rotation + attempt * 2.399963229728653 + next() * 0.45;
    const distance =
      radius * (0.2 + ((attempt % 3) / 2) * 0.42) + (next() - 0.5) * 0.6;
    const point = {
      x: ARENA.cx + Math.cos(angle) * distance,
      z: ARENA.cz + Math.sin(angle) * distance,
    };
    if (distance + r > radius - 2) continue;
    if (
      spawns.some(
        (spawn) => Math.hypot(spawn.x - point.x, spawn.z - point.z) < r + 2.1,
      )
    )
      continue;
    if (
      obstacles.some(
        (other) =>
          Math.hypot(other.x - point.x, other.z - point.z) < other.r + r + 1.1,
      )
    )
      continue;
    obstacles.push({ id: `arena-pad-${obstacles.length}`, kind, ...point, r });
  }
  return { radius, obstacles, guards };
}

const angleDistance = (a, b) =>
  Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/** Swept car disk against physical rail arcs, with interpolated jump height.
 * Returns the first safe contact position and an obstacle-outward normal.
 * On the arc face that normal points toward the arena center. Gaps stay open.
 */
export function arenaGuardContact(from, to, radius, guards = []) {
  if (
    ![from?.x, from?.z, to?.x, to?.z, radius].every(Number.isFinite) ||
    radius <= 0
  )
    return null;
  const dx = to.x - from.x,
    dz = to.z - from.z;
  const length2 = dx * dx + dz * dz;
  if (length2 < 1e-12) return null;
  const bodyRadius = ARENA.carRadius + ARENA.guardThickness / 2;
  const inner = radius - bodyRadius;
  const fx = from.x - ARENA.cx,
    fz = from.z - ARENA.cz;
  const candidates = [];
  const lowEnough = (t) =>
    (Number.isFinite(from.y) ? from.y : 0) * (1 - t) +
      (Number.isFinite(to.y) ? to.y : 0) * t <=
    ARENA.guardHeight;
  const add = (
    t,
    nx,
    nz,
    guardId,
    px = from.x + dx * t,
    pz = from.z + dz * t,
  ) => {
    if (t >= 0 && t <= 1 && lowEnough(t))
      candidates.push({
        t,
        x: px + nx * 0.005,
        z: pz + nz * 0.005,
        nx,
        nz,
        guardId,
      });
  };
  const b = fx * dx + fz * dz;
  const discriminant = b * b - length2 * (fx * fx + fz * fz - inner * inner);
  for (const guard of guards) {
    if (
      ![guard.angle, guard.halfAngle].every(Number.isFinite) ||
      guard.halfAngle <= 0
    )
      continue;
    const fromDistance = Math.hypot(fx, fz);
    if (
      fromDistance > inner &&
      fromDistance <= radius &&
      b > 0 &&
      angleDistance(Math.atan2(fz, fx), guard.angle) <= guard.halfAngle
    )
      add(
        0,
        -fx / fromDistance,
        -fz / fromDistance,
        guard.id,
        ARENA.cx + (fx * inner) / fromDistance,
        ARENA.cz + (fz * inner) / fromDistance,
      );
    if (discriminant >= 0) {
      const t = (-b + Math.sqrt(discriminant)) / length2;
      const x = fx + dx * t,
        z = fz + dz * t;
      if (angleDistance(Math.atan2(z, x), guard.angle) <= guard.halfAngle)
        add(t, -x / inner, -z / inner, guard.id);
    }
    // Round rail ends are physical too, including glancing contacts within the ring.
    for (const angle of [
      guard.angle - guard.halfAngle,
      guard.angle + guard.halfAngle,
    ]) {
      const ex = ARENA.cx + Math.cos(angle) * radius;
      const ez = ARENA.cz + Math.sin(angle) * radius;
      const ox = from.x - ex,
        oz = from.z - ez;
      const eb = ox * dx + oz * dz;
      const ec = ox * ox + oz * oz - bodyRadius * bodyRadius;
      const ed = eb * eb - length2 * ec;
      if (ed < 0) continue;
      const t = ec <= 0 ? 0 : (-eb - Math.sqrt(ed)) / length2;
      const nx = from.x + dx * t - ex,
        nz = from.z + dz * t - ez;
      const normalLength = Math.hypot(nx, nz);
      if (normalLength > 1e-8 && dx * nx + dz * nz < 0)
        add(
          t,
          nx / normalLength,
          nz / normalLength,
          guard.id,
          ex + (nx / normalLength) * bodyRadius,
          ez + (nz / normalLength) * bodyRadius,
        );
    }
  }
  candidates.sort((a, b) => a.t - b.t);
  if (!candidates.length) return null;
  const { t: _t, ...contact } = candidates[0];
  return contact;
}
