import test from "node:test";
import assert from "node:assert/strict";
import {
  TRACK_LENGTH,
  trackPoint,
  projectTrack,
  isDriveable,
  ITEMS,
  ITEM_BY_ID,
  RARITIES,
  STARTER_EQUIPPED,
  LAP_REWARD,
  CRATE_COST,
  DUEL_TRACK,
  DUEL_LENGTH,
  duelStart,
  projectDuel,
  CONNECTOR,
  recoveryHeading,
} from "./gameConfig.js";

test("stadium projection is continuous across straight/curve seams and lap boundary", () => {
  for (let i = 0; i < 1000; i++) {
    const progress = i / 1000;
    const point = trackPoint(progress);
    const projection = projectTrack(point.x, point.z);
    assert.ok(projection.distance < 1e-8);
    assert.ok(Math.abs(projection.progress - progress) < 1e-8);
    assert.ok(isDriveable(point.x, point.z));
    const next = trackPoint(progress + 0.001);
    assert.ok(
      Math.hypot(next.x - point.x, next.z - point.z) <=
        TRACK_LENGTH / 1000 + 1e-8,
    );
    const dx = next.x - point.x,
      dz = next.z - point.z;
    assert.ok(dx * Math.sin(point.heading) + dz * Math.cos(point.heading) > 0);
  }
  assert.deepEqual(trackPoint(0), trackPoint(1));
});

test("the straight duel has two parallel starts and a separate padded driveable rectangle", () => {
  assert.equal(DUEL_LENGTH, 42);
  for (const lane of [0, 1]) {
    const start = duelStart(lane);
    assert.equal(start.heading, Math.PI);
    assert.equal(start.z, 18);
    assert.equal(start.x, DUEL_TRACK.cx + (lane ? 1.25 : -1.25));
    for (let step = 0; step <= 100; step += 1) {
      const z = DUEL_TRACK.startZ - (DUEL_LENGTH * step) / 100;
      const projection = projectDuel(start.x, z);
      assert.ok(Math.abs(projection.progress - step / 100) < 1e-12);
      assert.equal(projection.inside, true);
      assert.ok(isDriveable(start.x, z));
    }
  }
  assert.equal(projectDuel(-31, 22).progress, 0);
  assert.equal(projectDuel(-31, -28).progress, 1);
  assert.ok(isDriveable(-31, 22));
  assert.ok(isDriveable(-31, -28));
  for (const [x, z] of [
    [-31, 22.01],
    [-31, -28.01],
    [-34.21, 0],
    [-27.79, 0],
    [-24, 0],
  ]) {
    assert.equal(isDriveable(x, z), false);
  }
  assert.equal(projectDuel(NaN, 0).inside, false);
  assert.equal(projectDuel(0, Infinity).inside, false);
});
test("driveable space connects the island to the rail and rejects off-track shortcuts", () => {
  for (let z = 18; z <= 29; z += 0.1) assert.ok(isDriveable(0, z));
  assert.equal(isDriveable(0, 34), false);
  assert.equal(isDriveable(17, 23), false);
  assert.equal(isDriveable(0, 42), false);
  assert.equal(isDriveable(NaN, 20), false);
  assert.equal(isDriveable(0, Infinity), false);
});

test("the wide connector joins both shores without making its side water driveable", () => {
  assert.equal(CONNECTOR.halfWidth, 4.5);
  for (const x of [-4.5, -4.35, 0, 4.35, 4.5]) {
    for (let index = 0; index <= 110; index += 1) {
      const z =
        CONNECTOR.startZ + ((CONNECTOR.endZ - CONNECTOR.startZ) * index) / 110;
      assert.ok(
        isDriveable(x, z),
        `connector edge must remain joined at ${x},${z}`,
      );
    }
  }
  for (const x of [-4.51, 4.51, -12, 12])
    assert.equal(
      isDriveable(x, 24),
      false,
      "widening must not create a water shortcut",
    );
  assert.equal(isDriveable(0, 34), false);
  assert.equal(isDriveable(-24, 0), false);
});

test("edge recovery points back onto connected ground for both forward and reverse driving", () => {
  const poses = [
    { x: -6, z: 20.4 },
    { x: 6, z: 20.4 },
    { x: -4.49, z: 24 },
    { x: 4.49, z: 24 },
    { x: 8, z: 40.99 },
    { x: DUEL_TRACK.cx - DUEL_TRACK.halfWidth + 0.01, z: 0 },
  ];
  for (const pose of poses) {
    assert.ok(isDriveable(pose.x, pose.z));
    for (const direction of [-1, 1]) {
      const heading = recoveryHeading(pose.x, pose.z, direction);
      for (let distance = 0.05; distance <= 0.8; distance += 0.05)
        assert.ok(
          isDriveable(
            pose.x + Math.sin(heading) * distance * direction,
            pose.z + Math.cos(heading) * distance * direction,
          ),
          `recovery must move into the road from ${pose.x},${pose.z}, direction ${direction}`,
        );
    }
  }
});
test("catalog has unique items, valid starter slots, complete drop tiers and requested economy", () => {
  assert.equal(ITEMS.length, ITEM_BY_ID.size);
  assert.equal(
    RARITIES.reduce((sum, r) => sum + r.weight, 0),
    100,
  );
  assert.deepEqual(
    RARITIES.map((r) => r.weight),
    [75, 20, 4, 1],
  );
  for (const rarity of RARITIES)
    assert.ok(ITEMS.some((item) => !item.starter && item.rarity === rarity.id));
  for (const [slot, id] of Object.entries(STARTER_EQUIPPED)) {
    assert.equal(ITEM_BY_ID.get(id).type, slot);
    assert.equal(ITEM_BY_ID.get(id).starter, true);
  }
  assert.equal(LAP_REWARD, 20);
  assert.equal(CRATE_COST, 100);
});
