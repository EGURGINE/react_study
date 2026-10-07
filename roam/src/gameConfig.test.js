import test from "node:test";
import assert from "node:assert/strict";
import {
  TRACK_LENGTH,
  TRACK,
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
  duelPoint,
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

test("the outer duel is a continuous closed stadium with matching projection and two side-by-side starts", () => {
  assert.ok(DUEL_LENGTH > 230 && DUEL_LENGTH < 235);
  for (const lane of [0, 1]) {
    const start = duelStart(lane);
    assert.equal(start.heading, Math.PI);
    assert.equal(start.z, DUEL_TRACK.cz);
    assert.deepEqual(
      start,
      duelPoint(0, (lane ? 1 : -1) * DUEL_TRACK.laneOffset),
    );
  }
  for (let step = 0; step < 1000; step += 1) {
    const progress = step / 1000;
    for (const offset of [-3.19, -1.25, 0, 1.25, 3.19]) {
      const point = duelPoint(progress, offset);
      const projected = projectDuel(point.x, point.z);
      const difference = Math.abs(projected.progress - progress);
      assert.ok(Math.min(difference, 1 - difference) < 1e-10);
      assert.ok(Math.abs(projected.lateralOffset - offset) < 1e-10);
      assert.ok(Math.abs(projected.distance - Math.abs(offset)) < 1e-10);
      assert.ok(projected.inside);
      assert.ok(isDriveable(point.x, point.z));
      const next = duelPoint(progress + 0.00001, offset);
      assert.ok(
        (next.x - point.x) * Math.sin(point.heading) +
          (next.z - point.z) * Math.cos(point.heading) >
          0,
      );
    }
    const outside = duelPoint(progress, DUEL_TRACK.halfWidth + 0.01);
    assert.equal(projectDuel(outside.x, outside.z).inside, false);
  }
  assert.deepEqual(duelPoint(0), duelPoint(1));
  assert.deepEqual(duelPoint(0.25), duelPoint(1.25));
  assert.equal(projectDuel(NaN, 0).inside, false);
  assert.equal(projectDuel(0, Infinity).inside, false);
});

test("the outer course surrounds but never overlaps the island, bridge, or reward rail", () => {
  for (let step = 0; step < 720; step += 1) {
    const angle = (step * Math.PI) / 360;
    assert.equal(
      projectDuel(Math.cos(angle) * 21.3, Math.sin(angle) * 21.3).inside,
      false,
    );
    const rail = trackPoint(step / 720);
    for (const side of [-1, 1]) {
      const x = rail.x + Math.cos(rail.heading) * side * TRACK.halfWidth;
      const z = rail.z - Math.sin(rail.heading) * side * TRACK.halfWidth;
      assert.ok(projectDuel(x, z).distance - DUEL_TRACK.halfWidth >= 1.79);
    }
  }
  for (const x of [-CONNECTOR.halfWidth, 0, CONNECTOR.halfWidth])
    for (let z = CONNECTOR.startZ; z <= CONNECTOR.endZ; z += 0.5)
      assert.equal(projectDuel(x, z).inside, false);
  assert.equal(projectDuel(DUEL_TRACK.cx, DUEL_TRACK.cz).inside, false);
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
    duelPoint(0.2, DUEL_TRACK.halfWidth - 0.01),
    duelPoint(0.65, -DUEL_TRACK.halfWidth + 0.01),
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
    [74.5, 20, 4, 1, 0.5],
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
