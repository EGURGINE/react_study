import { findPath } from "./navigation.js";
import {
  TRACK,
  TRACK_LENGTH,
  trackPoint,
  projectTrack,
  projectDuel,
  duelPoint,
  DUEL_LENGTH,
  isDriveable,
} from "./gameConfig.js";

const ISLAND_GATE = { x: 0, z: 20.7 };
const TRACK_GATE = trackPoint(0);
const island = (point) => Math.hypot(point.x, point.z) <= 21.3;
const rail = (point) =>
  projectTrack(point.x, point.z).distance <= TRACK.halfWidth;
const point = (p) => ({ x: p.x, z: p.z });

function alongTrack(start, target) {
  const from = projectTrack(start.x, start.z);
  const to = projectTrack(target.x, target.z);
  const delta = (to.progress - from.progress + 1) % 1;
  const count = Math.max(1, Math.ceil((Math.abs(delta) * TRACK_LENGTH) / 0.9));
  const result = [point(from)];
  for (let index = 1; index <= count; index++)
    result.push(point(trackPoint(from.progress + (delta * index) / count)));
  result.push(point(target));
  return result;
}

function alongDuel(start, target) {
  const from = projectDuel(start.x, start.z);
  const to = projectDuel(target.x, target.z);
  const wrapped = (to.progress - from.progress + 1) % 1;
  const delta = wrapped < 1e-9 || wrapped > 1 - 1e-9 ? 0 : wrapped;
  const distance = delta * DUEL_LENGTH;
  const count = Math.max(1, Math.ceil(distance / 0.9));
  const transition = Math.min(15, distance);
  const result = [point(duelPoint(from.progress, from.lateralOffset))];
  for (let index = 1; index <= count; index += 1) {
    // Depart in the current lane before gradually steering toward the clicked
    // lane. A centerline waypoint would turn both starting cars into each other.
    const amount = transition
      ? Math.min(1, (distance * index) / count / transition)
      : 1;
    const blend = amount * amount * (3 - 2 * amount);
    const offset =
      from.lateralOffset + (to.lateralOffset - from.lateralOffset) * blend;
    result.push(
      point(duelPoint(from.progress + (delta * index) / count, offset)),
    );
  }
  return result;
}

/** Route the island, narrow connector, and rail without crossing the track hole. */
export function findWorldPath(start, target, colliders = []) {
  if (
    !start ||
    !target ||
    !isDriveable(start.x, start.z) ||
    !Number.isFinite(target.x) ||
    !Number.isFinite(target.z)
  )
    return [];
  const startInDuel = projectDuel(start.x, start.z).inside;
  const targetInDuel = projectDuel(target.x, target.z).inside;
  if (startInDuel || targetInDuel) {
    if (!startInDuel || !targetInDuel) return [];
    return Math.hypot(start.x - target.x, start.z - target.z) < 0.05
      ? []
      : alongDuel(start, target);
  }
  if (!isDriveable(target.x, target.z)) {
    if (Math.abs(target.x) > 22 || target.z < 24 || target.z > 43) return [];
    target = point(projectTrack(target.x, target.z));
  }
  if (Math.hypot(start.x - target.x, start.z - target.z) < 0.05) return [];
  const islandPath = (from, to) =>
    findPath(from, to, colliders, {
      radius: 21.3,
      clearance: 0.82,
      step: 0.55,
    });
  if (island(start) && island(target)) return islandPath(start, target);

  const path = [];
  let origin = start;
  if (island(start)) {
    const exit = islandPath(start, ISLAND_GATE);
    if (!exit.length && Math.hypot(start.x, start.z - ISLAND_GATE.z) > 0.05)
      return [];
    path.push(...exit);
    origin = ISLAND_GATE;
  }

  if (island(target)) {
    if (rail(origin)) path.push(...alongTrack(origin, TRACK_GATE));
    path.push({ x: 0, z: Math.min(27, origin.z) }, ISLAND_GATE);
    const arrival = islandPath(ISLAND_GATE, target);
    if (
      !arrival.length &&
      Math.hypot(target.x, target.z - ISLAND_GATE.z) > 0.05
    )
      return [];
    path.push(...arrival);
  } else if (rail(target)) {
    if (!rail(origin))
      path.push(
        { x: 0, z: Math.max(21, origin.z) },
        { x: 0, z: 26 },
        point(TRACK_GATE),
      );
    path.push(...alongTrack(rail(origin) ? origin : TRACK_GATE, target));
  } else {
    if (rail(origin)) path.push(...alongTrack(origin, TRACK_GATE));
    path.push({ x: 0, z: target.z }, point(target));
  }
  return path.filter((next, index) => {
    const previous = index ? path[index - 1] : start;
    return Math.hypot(next.x - previous.x, next.z - previous.z) > 0.04;
  });
}
