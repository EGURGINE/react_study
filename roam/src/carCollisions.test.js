import test from "node:test";
import assert from "node:assert/strict";
import {
  CAR_CONTACT,
  ARENA_CAR_CONTACT,
  carContact,
  movementVelocity,
} from "./carCollisions.js";
const pose = (x, z = 0, y = 0) => ({ x, z, y, heading: Math.PI / 2 });
test("ordinary rear-end contact gives both cars a quarter-bumper rebound", () => {
  const hit = carContact(pose(-2), pose(-1), pose(0), { x: 7, z: 0 });
  assert.equal(CAR_CONTACT.bumperFraction, 0.25);
  assert.equal(
    hit.b.vx,
    CAR_CONTACT.bumperImpulse * CAR_CONTACT.bumperFraction,
  );
  assert.equal(hit.b.vx, 2.5);
  assert.equal(hit.a.vx, -hit.b.vx);
  assert.equal(hit.a.spin, -hit.b.spin);
  const gentle = carContact(pose(-2), pose(-1), pose(0), { x: 2, z: 0 });
  assert.ok(gentle.b.vx >= 1 && gentle.b.vx <= 1.5);
  assert.ok(gentle.strength < hit.strength);
  for (const speed of [6, 8]) {
    const approaching = carContact(pose(-2), pose(-1), pose(0), {
      x: speed,
      z: 0,
    });
    assert.ok(approaching.b.vx >= 2 && approaching.b.vx <= 3);
  }
  const movingPeer = carContact(
    pose(-2),
    pose(-1),
    pose(0),
    { x: 9, z: 0 },
    { x: 2, z: 0 },
  );
  assert.deepEqual(movingPeer, hit);
});
test("head-on and side impacts remain bounded and swept contacts cannot tunnel", () => {
  const hit = carContact(
    pose(-2),
    pose(2),
    pose(0),
    { x: 24, z: 0 },
    { x: -24, z: 0 },
  );
  assert.equal(hit.b.vx, CAR_CONTACT.maxImpulse);
  assert.equal(hit.a.vx, -CAR_CONTACT.maxImpulse);
  const side = carContact(pose(0, -2), pose(0, -1), pose(0), { x: 0, z: 8 });
  assert.ok(side.b.vz >= 2 && side.b.vz <= 3);
  assert.ok(side.a.vz < 0 && side.b.vz > 0);
  assert.ok(Math.abs(side.a.spin) > 0.5);
});
test("vehicle mass shares contact momentum while heavier cars move and spin less", () => {
  for (const speed of [4, 12, 48]) {
    const light = { mass: 0.7, bounce: 1 };
    const heavy = { mass: 1.8, bounce: 1 };
    const hit = carContact(
      pose(-2),
      pose(-1),
      pose(0),
      { x: speed, z: 0 },
      { x: 0, z: 0 },
      light,
      heavy,
    );
    assert.ok(Math.abs(hit.a.vx) > Math.abs(hit.b.vx));
    assert.ok(Math.abs(hit.a.spin) > Math.abs(hit.b.spin));
    assert.ok(Math.abs(hit.a.vx * light.mass + hit.b.vx * heavy.mass) < 1e-10);
    assert.ok(
      Math.abs(hit.a.vx) <= CAR_CONTACT.maxImpulse &&
        Math.abs(hit.b.vx) <= CAR_CONTACT.maxImpulse,
    );
    assert.ok(hit.strength <= 1);
    const swapped = carContact(
      pose(-2),
      pose(-1),
      pose(0),
      { x: speed, z: 0 },
      { x: 0, z: 0 },
      heavy,
      light,
    );
    assert.ok(Math.abs(swapped.a.vx) < Math.abs(swapped.b.vx));
    assert.equal(Math.abs(swapped.a.vx), Math.abs(hit.b.vx));
  }
});
test("arena mode preserves the original strong impulses and mass safety cap", () => {
  for (const speed of [2, 7, 12, 48]) {
    const hit = carContact(
      pose(-2),
      pose(-1),
      pose(0),
      { x: speed, z: 0 },
      undefined,
      undefined,
      undefined,
      { mode: "arena" },
    );
    const expected = Math.min(14, Math.max(1.8, speed * 0.9));
    assert.equal(hit.b.vx, expected);
    assert.equal(hit.a.vx, -expected);
    assert.equal(hit.strength, expected / 14);
    assert.equal(Math.abs(hit.a.spin), Math.min(2.8, 0.3 + expected * 0.2));
    assert.ok(Math.abs(hit.a.vx) * 1.75 <= 24.5);
  }
  const light = { mass: 0.7, bounce: 1.3 };
  const heavy = { mass: 1.8, bounce: 1.3 };
  const impact = carContact(
    pose(-2),
    pose(-1),
    pose(0),
    { x: 40, z: 0 },
    { x: -40, z: 0 },
    light,
    heavy,
    { mode: "arena" },
  );
  assert.equal(Math.abs(impact.a.vx), ARENA_CAR_CONTACT.maxImpulse);
  assert.ok(
    Math.abs(impact.a.vx * light.mass + impact.b.vx * heavy.mass) < 1e-10,
  );
});
test("vehicle bounce changes restitution without removing impact safety caps", () => {
  const hit = (bounce) =>
    carContact(
      pose(-2),
      pose(-1),
      pose(0),
      { x: 5, z: 0 },
      { x: 0, z: 0 },
      { mass: 1, bounce },
      { mass: 1, bounce },
    );
  assert.ok(hit(0.68).strength < hit(1).strength);
  assert.ok(hit(1).strength < hit(1.3).strength);
  const ordinary = carContact(pose(-2), pose(-1), pose(0), { x: 5, z: 0 });
  assert.deepEqual(hit(1), ordinary);
});
test("stationary, separating, distant and jumping cars do not collide", () => {
  for (const [before, after, peer, velocity] of [
    [pose(-1), pose(-1), pose(0), { x: 0, z: 0 }],
    [pose(-1), pose(-2), pose(0), { x: -10, z: 0 }],
    [pose(-2, 3), pose(-1, 3), pose(0), { x: 10, z: 0 }],
    [pose(-2, 0, 2), pose(-1, 0, 2), pose(0), { x: 10, z: 0 }],
  ])
    assert.equal(carContact(before, after, peer, velocity), null);
});
test("off-center swept side-swipe uses the first contact normal", () => {
  const hit = carContact(pose(-0.52, 1.45), pose(0.52, 1.45), pose(0), {
    x: 13,
    z: 0,
  });
  assert.ok(hit);
  assert.ok(hit.b.vz < -1);
  assert.ok(hit.a.vz > 1);
});
test("velocity uses accepted intervals and bounds delayed or burst updates", () => {
  assert.deepEqual(movementVelocity(pose(0), pose(3), 1), { x: 0, z: 0 });
  assert.deepEqual(movementVelocity(pose(0), pose(3), 0.001), { x: 0, z: 0 });
  assert.equal(movementVelocity(pose(0), pose(3), 0.08).x, 24);
});
