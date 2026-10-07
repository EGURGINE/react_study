import { DUEL_TRACK, DUEL_LENGTH } from "./gameConfig.js";

// Shared local prediction and server validation limits. Obstacles never grant
// a larger movement budget or allow leaving the existing course bounds.
export const DUEL_MOVEMENT_LIMITS = Object.freeze({
  maxSpeed: 24,
  maxHeight: 8,
  proximityAllowance: 2,
  triggerHeightAllowance: 0.85,
});
export const DUEL_OBSTACLE_RULES = Object.freeze({
  jump: Object.freeze({
    r: 0.85,
    cooldownMs: 1800,
    maxTriggerHeight: 0.55,
    jumpVelocity: 8.8,
  }),
  bounce: Object.freeze({
    r: 0.65,
    cooldownMs: 1200,
    maxTriggerHeight: 0.55,
    speed: 10,
    jumpVelocity: 3.2,
  }),
});

/** A server-selected seed creates one fixed, mirrored layout for each race. */
export function createDuelObstacles(seed, raceId) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new RangeError(
      "Duel obstacle seed must be an unsigned 32-bit integer",
    );
  if (typeof raceId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(raceId))
    throw new TypeError("Duel obstacles require a stable race ID");
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
  const rows = random() < 0.5 ? 3 : 4;
  const firstKind = random() < 0.5 ? "jump" : "bounce";
  const obstacles = [];
  for (let row = 0; row < rows; row += 1) {
    const kind =
      row === 0
        ? firstKind
        : row === rows - 1
          ? firstKind === "jump"
            ? "bounce"
            : "jump"
          : random() < 0.5
            ? "jump"
            : "bounce";
    const distance =
      8 + ((DUEL_LENGTH - 16) * row) / (rows - 1) + (random() - 0.5) * 1.2;
    const offset = (random() < 0.5 ? -1 : 1) * (0.45 + random() * 0.1);
    for (const lane of [0, 1]) {
      obstacles.push(
        Object.freeze({
          id: `duel-${raceId}-${row}-${lane}`,
          kind,
          lane,
          x:
            DUEL_TRACK.cx +
            (lane === 0 ? -1 : 1) * (DUEL_TRACK.laneOffset + offset),
          z: DUEL_TRACK.startZ - distance,
          r: DUEL_OBSTACLE_RULES[kind].r,
        }),
      );
    }
  }
  return Object.freeze(obstacles);
}
