import test from "node:test";
import assert from "node:assert/strict";
import { SOCCER } from "./soccerConfig.js";
import { carContact } from "./carCollisions.js";
import { VEHICLE_PROFILES, advanceDriveSpeed } from "./vehicleDynamics.js";
import {
  applySoccerCarImpulse,
  resolveSoccerWall,
  SOCCER_IMPACT_DRAG,
  soccerNavigationSpeed,
} from "./soccerDriving.js";

function advance(state, profile, dt, boost = false) {
  state.speed = advanceDriveSpeed(
    state.speed,
    { throttle: 1, boost },
    dt,
    profile,
  );
  state.heading += (state.spin || 0) * dt;
  let vx = Math.sin(state.heading) * state.speed + state.impactX;
  let vz = Math.cos(state.heading) * state.speed + state.impactZ;
  const limit = Math.min(
    1,
    (SOCCER.maxCarSpeed - 2) / (Math.hypot(vx, vz) || 1),
  );
  vx *= limit;
  vz *= limit;
  state.x += vx * dt;
  state.z += vz * dt;
  const wall = resolveSoccerWall({ ...state, vx, vz });
  Object.assign(state, {
    x: wall.x,
    z: wall.z,
    impactX: wall.impactX,
    impactZ: wall.impactZ,
  });
  state.impactX *= Math.exp(-SOCCER_IMPACT_DRAG * profile.grip * dt);
  state.impactZ *= Math.exp(-SOCCER_IMPACT_DRAG * profile.grip * dt);
  state.spin = (state.spin || 0) * Math.exp(-3.2 * profile.grip * dt);
  return { vx, vz, hit: wall.hit };
}

test("continuous glancing wall contact preserves steering and tangential travel at 30/60/120fps", () => {
  const profile = VEHICLE_PROFILES.jeep;
  const outcomes = [];
  for (const fps of [30, 60, 120]) {
    const state = {
      x: SOCCER.cx - 8,
      z: SOCCER.cz + SOCCER.halfWidth - SOCCER.carRadius,
      speed: profile.topSpeed,
      heading: Math.PI / 3,
      impactX: 0,
      impactZ: 0,
    };
    let contacts = 0;
    for (let i = 0; i < fps * 2; i++) {
      if (advance(state, profile, 1 / fps).hit) contacts++;
      assert.ok(state.z <= SOCCER.cz + SOCCER.halfWidth - SOCCER.carRadius);
      assert.ok(
        state.speed >= profile.topSpeed * 0.99,
        "wall contact must not repeatedly throttle the motor",
      );
    }
    assert.ok(
      contacts > 1,
      "exercise repeated contact rather than one isolated bounce",
    );
    assert.ok(
      state.x - (SOCCER.cx - 8) > 10,
      "the car still travels briskly along the wall",
    );
    // Steering away immediately gets the car back onto open grass.
    state.heading = (Math.PI * 2) / 3;
    const edgeZ = state.z;
    for (let i = 0; i < fps / 2; i++) advance(state, profile, 1 / fps);
    assert.ok(
      state.z < edgeZ - 1,
      "a wall touch cannot leave the car stuck crawling",
    );
    outcomes.push(state.x);
  }
  assert.ok(Math.max(...outcomes) - Math.min(...outcomes) < 0.05);
});

test("soccer click-to-drive uses each car's full normal or boosted speed and still slows for turns and arrival", () => {
  for (const profile of Object.values(VEHICLE_PROFILES))
    for (const boost of [false, true]) {
      const limit = boost ? profile.boostSpeed : profile.topSpeed;
      assert.equal(soccerNavigationSpeed(100, 0, profile, boost), limit);
      assert.equal(soccerNavigationSpeed(0, 0, profile, boost), 0);
      assert.ok(soccerNavigationSpeed(0.05, 0, profile, boost) < 0.3);
      assert.ok(
        soccerNavigationSpeed(100, Math.PI / 2, profile, boost) < limit * 0.2,
      );
      assert.ok(soccerNavigationSpeed(100, Math.PI / 2, profile, boost) > 0);
      for (const distance of [0.05, 0.2, 1, 10, 100])
        for (const turn of [-Math.PI, -0.5, 0, 0.5, Math.PI])
          assert.ok(
            soccerNavigationSpeed(distance, turn, profile, boost) <= limit,
          );
    }
});

test("wall reflection removes no tangential velocity and permits inward motion from an authoritative edge pose", () => {
  const heading = Math.PI / 3,
    speed = 10;
  const input = {
    x: SOCCER.cx + SOCCER.halfLength,
    z: SOCCER.cz,
    heading,
    speed,
    vx: Math.sin(heading) * speed,
    vz: Math.cos(heading) * speed,
    impactX: 0,
    impactZ: 0,
  };
  const wall = resolveSoccerWall(input);
  assert.ok(
    Math.sin(heading) * speed + wall.impactX < 0,
    "the car visibly rebounds from the wall",
  );
  assert.equal(wall.impactZ, 0, "the tangent retains all of its speed");
  const inward = resolveSoccerWall({ ...input, vx: -2, impactX: -12 });
  assert.equal(
    inward.impactX,
    -12,
    "an inward-moving correction never bounces the car back toward the wall",
  );
});

test("side impacts preserve forward motion rather than cutting the whole engine to eighteen percent", () => {
  const speed = 8,
    heading = Math.PI / 2;
  const result = applySoccerCarImpulse(
    { speed, heading, impactX: 0, impactZ: 0 },
    { vx: 0, vz: 10 },
  );
  assert.ok(Math.abs(result.speed - speed) < 1e-9);
  assert.ok(Math.abs(result.impactX) < 1e-9);
  assert.equal(result.impactZ, 10);
  const beforeX = Math.sin(heading) * speed;
  assert.ok(
    Math.abs(Math.sin(heading) * result.speed + result.impactX - beforeX) <
      1e-9,
  );
});

test("both accelerating cars rebound after real server impulses and recover normal speed within a second", () => {
  for (const [left, right] of [
    ["jeep", "jeep"],
    ["buggy", "buggy"],
    ["monster", "monster"],
    ["monster", "buggy"],
  ])
    for (const fps of [30, 60, 120])
      for (const boost of [false, true]) {
        const a = VEHICLE_PROFILES[left],
          b = VEHICLE_PROFILES[right];
        const speedA = boost ? a.boostSpeed : a.topSpeed;
        const speedB = boost ? b.boostSpeed : b.topSpeed;
        const contact = carContact(
          { x: SOCCER.cx - 0.8, z: SOCCER.cz },
          { x: SOCCER.cx - 0.7, z: SOCCER.cz, heading: Math.PI / 2 },
          { x: SOCCER.cx + 0.7, z: SOCCER.cz, heading: -Math.PI / 2 },
          { x: speedA, z: 0 },
          { x: -speedB, z: 0 },
          a,
          b,
          { mode: "soccer" },
        );
        assert.ok(contact);
        const variants = [
          [a, speedA, Math.PI / 2, contact.a, -1],
          [b, speedB, -Math.PI / 2, contact.b, 1],
        ];
        for (const [profile, speed, heading, push, outward] of variants) {
          const state = {
            x: SOCCER.cx - outward * 0.7,
            z: SOCCER.cz,
            heading,
            spin: push.spin,
            ...applySoccerCarImpulse(
              { speed, heading, impactX: 0, impactZ: 0 },
              push,
            ),
          };
          const startX = state.x;
          let outwardFrames = 0,
            maxOutward = 0;
          for (let i = 0; i < fps; i++) {
            const velocity = advance(state, profile, 1 / fps, boost);
            if (velocity.vx * outward > 0) outwardFrames++;
            maxOutward = Math.max(maxOutward, (state.x - startX) * outward);
            assert.ok(
              Math.hypot(velocity.vx, velocity.vz) <= SOCCER.maxCarSpeed,
            );
          }
          const label = `${left}/${right}, ${fps}fps, boost=${boost}, mass=${profile.mass}`;
          assert.ok(
            outwardFrames / fps >= 0.1,
            `visible rebound duration: ${label}`,
          );
          assert.ok(
            maxOutward >= 0.17,
            `visible rebound distance: ${label} (${maxOutward})`,
          );
          assert.ok(
            state.speed >= profile.topSpeed * 0.9,
            `normal acceleration returns: ${label}`,
          );
          const actual = Math.hypot(
            Math.sin(state.heading) * state.speed + state.impactX,
            Math.cos(state.heading) * state.speed + state.impactZ,
          );
          assert.ok(
            actual >= profile.topSpeed * 0.75,
            `no lingering crawling velocity: ${label}`,
          );
        }
      }
});
