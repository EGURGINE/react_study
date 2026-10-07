import test from "node:test";
import assert from "node:assert/strict";
import {
  DUEL_TRACK,
  DUEL_LENGTH,
  duelPoint,
  projectDuel,
} from "./gameConfig.js";
import {
  createDuelObstacles,
  DUEL_OBSTACLE_RULES,
  DUEL_MOVEMENT_LIMITS,
} from "./duelObstacles.js";

test("seeded duel layouts are stable, race-scoped, mirrored, and leave both ends clear", () => {
  const patterns = new Set();
  const counts = new Set();
  for (let seed = 0; seed < 64; seed += 1) {
    const layout = createDuelObstacles(seed, "race-one");
    assert.deepEqual(layout, createDuelObstacles(seed, "race-one"));
    assert.ok([16, 18, 20].includes(layout.length));
    assert.equal(new Set(layout.map((item) => item.id)).size, layout.length);
    assert.deepEqual(
      new Set(layout.map((item) => item.kind)),
      new Set(["jump", "bounce", "boost"]),
    );
    counts.add(layout.length);
    patterns.add(JSON.stringify(layout));
    for (let index = 0; index < layout.length; index += 2) {
      const [left, right] = layout.slice(index, index + 2);
      assert.equal(left.lane, 0);
      assert.equal(right.lane, 1);
      assert.equal(left.progress, right.progress);
      assert.equal(left.heading, right.heading);
      assert.equal(left.kind, right.kind);
      const center = duelPoint(left.progress);
      assert.ok(Math.abs(left.x + right.x - 2 * center.x) < 1e-10);
      assert.ok(Math.abs(left.z + right.z - 2 * center.z) < 1e-10);
      assert.ok(left.progress * DUEL_LENGTH - left.r >= 8);
      assert.ok((1 - left.progress) * DUEL_LENGTH - left.r >= 8);
      assert.ok(
        projectDuel(left.x, left.z).distance + left.r < DUEL_TRACK.halfWidth,
      );
      assert.equal(projectDuel(left.x, left.z).inside, true);
      if (index > 0)
        assert.ok(
          (left.progress - layout[index - 2].progress) * DUEL_LENGTH > 15,
        );
    }
  }
  assert.equal(counts.size, 3);
  assert.equal(patterns.size, 64);
  const first = createDuelObstacles(123, "race-one");
  const next = createDuelObstacles(123, "race-two");
  assert.ok(first.every((item, index) => item.id !== next[index].id));
  assert.deepEqual(
    first.map(({ id, ...item }) => item),
    next.map(({ id, ...item }) => item),
  );
});

test("obstacle physics stays inside existing movement limits and rejects malformed seeds", () => {
  assert.ok(DUEL_OBSTACLE_RULES.bounce.speed < DUEL_MOVEMENT_LIMITS.maxSpeed);
  assert.ok(DUEL_OBSTACLE_RULES.boost.speed < DUEL_MOVEMENT_LIMITS.maxSpeed);
  assert.equal(DUEL_OBSTACLE_RULES.boost.jumpVelocity, 0);
  assert.equal(DUEL_OBSTACLE_RULES.boost.duration, 1.5);
  assert.ok(
    DUEL_OBSTACLE_RULES.jump.jumpVelocity ** 2 / (2 * 12) <
      DUEL_MOVEMENT_LIMITS.maxHeight,
  );
  for (const rule of Object.values(DUEL_OBSTACLE_RULES)) {
    assert.ok(rule.cooldownMs >= 1000);
    assert.equal(rule.maxTriggerHeight, 0.55);
  }
  for (const seed of [-1, 1.5, NaN, Infinity, 0x100000000, "1"])
    assert.throws(() => createDuelObstacles(seed, "race"), RangeError);
  for (const id of [undefined, "", "../race", "x".repeat(81)])
    assert.throws(() => createDuelObstacles(1, id), TypeError);
});
