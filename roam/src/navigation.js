const EPSILON = 1e-8;
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const finitePoint = (point) =>
  point && Number.isFinite(point.x) && Number.isFinite(point.z);

class MinHeap {
  items = [];

  push(item) {
    let index = this.items.length;
    this.items.push(item);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.items[parent].score <= item.score) break;
      this.items[index] = this.items[parent];
      index = parent;
    }
    this.items[index] = item;
  }

  pop() {
    const first = this.items[0];
    const last = this.items.pop();
    if (this.items.length) {
      let index = 0;
      while (index * 2 + 1 < this.items.length) {
        let child = index * 2 + 1;
        if (
          child + 1 < this.items.length &&
          this.items[child + 1].score < this.items[child].score
        )
          child++;
        if (last.score <= this.items[child].score) break;
        this.items[index] = this.items[child];
        index = child;
      }
      this.items[index] = last;
    }
    return first;
  }
}

/**
 * Plan a route for a car center on a circular island. Waypoints exclude start.
 * Invalid or unreachable destinations return []; blocked targets snap to nearby
 * free ground. At most 9,801 grid nodes are considered, even with a tiny step.
 * A start inside the clearance margin may move directly out of that margin,
 * but may never move further into it or through the obstacle itself.
 */
export function findPath(start, target, colliders = [], options = {}) {
  const { radius = 13.35, clearance = 0.75, step = 0.6 } = options;
  if (
    !finitePoint(start) ||
    !finitePoint(target) ||
    !Number.isFinite(radius) ||
    radius <= 0 ||
    !Number.isFinite(clearance) ||
    clearance < 0 ||
    !Number.isFinite(step) ||
    step <= 0
  )
    return [];

  const obstacles = colliders.filter(
    (obstacle) =>
      finitePoint(obstacle) && Number.isFinite(obstacle.r) && obstacle.r >= 0,
  );
  const insideIsland = (point) =>
    point.x * point.x + point.z * point.z <= radius * radius + EPSILON;
  const walkable = (point) =>
    insideIsland(point) &&
    obstacles.every(
      (obstacle) =>
        distance(point, obstacle) >= obstacle.r + clearance - EPSILON,
    );

  if (
    !insideIsland(start) ||
    obstacles.some(
      (obstacle) => distance(start, obstacle) < obstacle.r - EPSILON,
    )
  )
    return [];

  // Checking the exact segment prevents thin circles from slipping between grid
  // samples. A circle is convex, so endpoints also guarantee the island bound.
  const segmentClear = (from, to, allowEscape = false) => {
    if (!insideIsland(from) || !walkable(to)) return false;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const lengthSquared = dx * dx + dz * dz;
    return obstacles.every((obstacle) => {
      const ox = from.x - obstacle.x;
      const oz = from.z - obstacle.z;
      const required = obstacle.r + clearance;
      const startDistanceSquared = ox * ox + oz * oz;
      if (allowEscape && startDistanceSquared < required * required - EPSILON) {
        return (
          startDistanceSquared >= obstacle.r * obstacle.r - EPSILON &&
          ox * dx + oz * dz >= -EPSILON
        );
      }
      const t =
        lengthSquared > 0
          ? Math.max(0, Math.min(1, -(ox * dx + oz * dz) / lengthSquared))
          : 0;
      const nearestX = ox + dx * t;
      const nearestZ = oz + dz * t;
      return (
        nearestX * nearestX + nearestZ * nearestZ >=
        required * required - EPSILON
      );
    });
  };

  const targetLength = Math.hypot(target.x, target.z);
  let goal =
    targetLength > radius
      ? {
          x: (target.x / targetLength) * radius,
          z: (target.z / targetLength) * radius,
        }
      : { x: target.x, z: target.z };
  if (walkable(goal) && segmentClear(start, goal, true))
    return distance(start, goal) > EPSILON ? [goal] : [];

  const half = Math.min(49, Math.max(1, Math.ceil(radius / step)));
  const spacing = radius / half;
  const width = half * 2 + 1;
  const count = width * width;
  const points = Array.from({ length: count }, (_, index) => ({
    x: ((index % width) - half) * spacing,
    z: (Math.floor(index / width) - half) * spacing,
  }));
  const openGround = points.map(walkable);

  if (!walkable(goal)) {
    let nearest = null;
    let nearestDistance = Infinity;
    const consider = (candidate) => {
      const candidateDistance = distance(candidate, goal);
      if (candidateDistance < nearestDistance && walkable(candidate)) {
        nearest = candidate;
        nearestDistance = candidateDistance;
      }
    };
    points.forEach((point, index) => {
      if (openGround[index]) consider(point);
    });
    // Preserve a natural click destination at an obstacle edge instead of
    // unnecessarily forcing every snapped target to the grid.
    for (const obstacle of obstacles) {
      const angle = Math.atan2(goal.z - obstacle.z, goal.x - obstacle.x);
      const r = obstacle.r + clearance + 1e-5;
      consider({
        x: obstacle.x + Math.cos(angle) * r,
        z: obstacle.z + Math.sin(angle) * r,
      });
    }
    // In overlaps, the closest free point can be where two boundaries meet,
    // including an obstacle meeting the island edge.
    const boundaries = [
      ...obstacles.map((obstacle) => ({
        ...obstacle,
        r: obstacle.r + clearance,
      })),
      { x: 0, z: 0, r: radius },
    ];
    for (let a = 0; a < boundaries.length; a++) {
      for (let b = a + 1; b < boundaries.length; b++) {
        const first = boundaries[a];
        const second = boundaries[b];
        const d = distance(first, second);
        if (
          d < EPSILON ||
          d > first.r + second.r ||
          d < Math.abs(first.r - second.r)
        )
          continue;
        const along = (first.r ** 2 - second.r ** 2 + d ** 2) / (2 * d);
        const perpendicular = Math.sqrt(Math.max(0, first.r ** 2 - along ** 2));
        const ux = (second.x - first.x) / d;
        const uz = (second.z - first.z) / d;
        consider({
          x: first.x + along * ux - perpendicular * uz,
          z: first.z + along * uz + perpendicular * ux,
        });
        consider({
          x: first.x + along * ux + perpendicular * uz,
          z: first.z + along * uz - perpendicular * ux,
        });
      }
    }
    if (!nearest) return [];
    goal = nearest;
    if (segmentClear(start, goal, true))
      return distance(start, goal) > EPSILON ? [goal] : [];
  }

  const costs = new Float64Array(count).fill(Infinity);
  const parents = new Int32Array(count).fill(-1);
  const closed = new Uint8Array(count);
  const queue = new MinHeap();

  // Virtual start connections handle non-grid starts, including island edges
  // and small clearance-margin escapes without teleporting the car.
  for (let index = 0; index < count; index++) {
    if (!openGround[index] || !segmentClear(start, points[index], true))
      continue;
    costs[index] = distance(start, points[index]);
    queue.push({
      index,
      cost: costs[index],
      score: costs[index] + distance(points[index], goal),
    });
  }

  while (queue.items.length) {
    const current = queue.pop();
    const { index } = current;
    if (closed[index] || current.cost !== costs[index]) continue;
    closed[index] = 1;
    if (segmentClear(points[index], goal)) {
      const path = [goal];
      for (let cursor = index; cursor !== -1; cursor = parents[cursor])
        path.push(points[cursor]);
      path.reverse();
      const simplified = [];
      let anchor = start;
      let cursor = 0;
      while (cursor < path.length) {
        let farthest = path.length - 1;
        while (
          farthest > cursor &&
          !segmentClear(anchor, path[farthest], simplified.length === 0)
        )
          farthest--;
        if (distance(anchor, path[farthest]) > EPSILON)
          simplified.push(path[farthest]);
        anchor = path[farthest];
        cursor = farthest + 1;
      }
      return simplified;
    }

    const x = index % width;
    const z = Math.floor(index / width);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (
          (!dx && !dz) ||
          x + dx < 0 ||
          x + dx >= width ||
          z + dz < 0 ||
          z + dz >= width
        )
          continue;
        const next = index + dz * width + dx;
        if (!openGround[next] || closed[next]) continue;
        if (
          dx &&
          dz &&
          (!openGround[index + dx] || !openGround[index + dz * width])
        )
          continue;
        if (!segmentClear(points[index], points[next])) continue;
        const cost = costs[index] + spacing * (dx && dz ? Math.SQRT2 : 1);
        if (cost >= costs[next]) continue;
        costs[next] = cost;
        parents[next] = index;
        queue.push({
          index: next,
          cost,
          score: cost + distance(points[next], goal),
        });
      }
    }
  }
  return [];
}
