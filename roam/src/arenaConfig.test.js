import test from "node:test";
import assert from "node:assert/strict";
import {
  ARENA,
  ARENA_OBSTACLE_RULES,
  arenaRadius,
  arenaSpawn,
  createArenaLayout,
  arenaGuardContact,
} from "./arenaConfig.js";
import { DUEL_TRACK, duelPoint } from "./gameConfig.js";

const pose = (x, z, y = 0) => ({ x: ARENA.cx + x, z: ARENA.cz + z, y });
function rng(seed) {
  return () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
}

test("every player count has safe separated inward-facing starts and nonoverlapping pads", () => {
  for (let count = 2; count <= 10; count++)
    for (let seed = 0; seed < 30; seed++) {
      const layout = createArenaLayout(count, rng(seed));
      assert.equal(layout.radius, (count + 8) * 1.5);
      assert.ok(layout.obstacles.length >= 6);
      assert.equal(new Set(layout.obstacles.map((item) => item.kind)).size, 3);
      assert.equal(
        new Set(layout.obstacles.map((item) => item.id)).size,
        layout.obstacles.length,
      );
      const starts = Array.from({ length: count }, (_, i) =>
        arenaSpawn(i, count),
      );
      for (const spawn of starts) {
        const dx = ARENA.cx - spawn.x,
          dz = ARENA.cz - spawn.z;
        assert.ok(
          Math.abs(
            Math.hypot(dx, dz) - (layout.radius - ARENA.spawnClearance),
          ) < 1e-9,
        );
        assert.ok(
          (Math.sin(spawn.heading) * dx + Math.cos(spawn.heading) * dz) /
            Math.hypot(dx, dz) >
            0.99999,
        );
      }
      for (const item of layout.obstacles) {
        assert.equal(item.r, ARENA_OBSTACLE_RULES[item.kind].r);
        assert.ok(
          Math.hypot(item.x - ARENA.cx, item.z - ARENA.cz) + item.r <=
            layout.radius - 2 + 1e-9,
        );
        for (const spawn of starts)
          assert.ok(
            Math.hypot(item.x - spawn.x, item.z - spawn.z) >= item.r + 2.1,
          );
        for (const other of layout.obstacles)
          if (other !== item)
            assert.ok(
              Math.hypot(item.x - other.x, item.z - other.z) >=
                item.r + other.r + 1.1,
            );
      }
      assert.ok(
        Math.abs(
          layout.guards.reduce((sum, guard) => sum + guard.halfAngle * 2, 0) /
            (Math.PI * 2) -
            0.3,
        ) < 1e-10,
      );
    }
  assert.deepEqual(
    createArenaLayout(6, rng(42)),
    createArenaLayout(6, rng(42)),
  );
  assert.ok(createArenaLayout(2, () => 0).obstacles.length >= 6);
  assert.equal(arenaRadius(100), 27);
  assert.equal(arenaRadius(-1), 15);
  assert.equal(arenaRadius(NaN), 15);
  assert.equal(arenaRadius(5.9), 19.5);
});

for (const radius of [ARENA.minRadius, ARENA.maxRadius])
  test(`swept guards protect the ${radius}m arena while keeping gaps and jumps open`, () => {
    const guards = [{ id: "east", angle: 0, halfAngle: 0.24 }];
    const contact = arenaGuardContact(
      pose(0, 0), pose(radius + 20, 0), radius, guards,
    );
    assert.ok(contact);
    assert.ok(contact.x - ARENA.cx < radius - ARENA.carRadius);
    assert.ok(contact.nx < -0.999 && Math.abs(contact.nz) < 1e-9);
    assert.equal(
      arenaGuardContact(pose(0, 0), pose(0, radius + 20), radius, guards),
      null,
    );
    assert.equal(
      arenaGuardContact(pose(0, 0, 3), pose(radius + 20, 0, 3), radius, guards),
      null,
    );
    assert.ok(
      arenaGuardContact(
        pose(radius - 2, 0, 2.8), pose(radius + 2, 0, 0), radius, guards,
      ),
    );
    assert.equal(
      arenaGuardContact(
        pose(radius - 2, 0, 0), pose(radius + 2, 0, 8), radius, guards,
      ),
      null,
    );
    const overlapping = arenaGuardContact(
      pose(radius - 0.3, 0), pose(radius + 1, 0), radius, guards,
    );
    assert.ok(
      overlapping &&
        overlapping.x - ARENA.cx <
          radius - ARENA.carRadius - ARENA.guardThickness / 2,
    );
    const angle =
      guards[0].halfAngle + Math.asin(ARENA.carRadius / radius) * 0.6;
    assert.ok(
      arenaGuardContact(
        pose((radius - 2) * Math.cos(angle), (radius - 2) * Math.sin(angle)),
        pose((radius + 2) * Math.cos(angle), (radius + 2) * Math.sin(angle)),
        radius,
        guards,
      ),
      "round arc endpoint catches a grazing car disk",
    );
  });

test("maximum arena architecture remains separate from the existing duel road", () => {
  for (let i = 0; i < 1024; i++) {
    const p = duelPoint(i / 1024);
    assert.ok(
      Math.hypot(p.x - ARENA.cx, p.z - ARENA.cz) >
        ARENA.maxRadius + 4.95 + DUEL_TRACK.halfWidth + 0.35,
    );
  }
});
