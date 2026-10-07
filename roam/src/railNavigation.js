import { findPath } from "./navigation.js";
import {
  TRACK,
  TRACK_LENGTH,
  trackPoint,
  projectTrack,
  projectDuel,
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
      : [point(target)];
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
