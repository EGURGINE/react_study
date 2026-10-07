import test from "node:test";
import assert from "node:assert/strict";
import { BODY_STYLES } from "./cosmeticsCatalog.js";
import {
  VEHICLE_PROFILES,
  getVehicleProfile,
  advanceDriveSpeed,
  smoothSteering,
  obstacleResponse,
} from "./vehicleDynamics.js";

const simulate = (profile, seconds, fps = 60, input = { throttle: 1 }) => {
  let speed = 0,
    distance = 0;
  for (let i = 0; i < seconds * fps; i++) {
    speed = advanceDriveSpeed(speed, input, 1 / fps, profile);
    distance += speed / fps;
  }
  return { speed, distance };
};
test("all 15 shapes have bounded shared stats and paint never changes performance", () => {
  assert.deepEqual(
    Object.keys(VEHICLE_PROFILES).sort(),
    [...BODY_STYLES].sort(),
  );
  for (const profile of Object.values(VEHICLE_PROFILES)) {
    assert.ok(Object.isFrozen(profile));
    for (const field of [
      "topSpeed",
      "boostSpeed",
      "acceleration",
      "steering",
      "grip",
      "mass",
      "bounce",
    ])
      assert.ok(Number.isFinite(profile[field]) && profile[field] > 0);
    assert.ok(profile.topSpeed < profile.boostSpeed && profile.boostSpeed < 22);
  }
  assert.equal(
    getVehicleProfile("body-starter"),
    getVehicleProfile("body-cream"),
  );
  assert.equal(getVehicleProfile("body-ocean"), getVehicleProfile("body-gold"));
  for (const bad of [
    null,
    "missing",
    "spray-wave",
    { id: "missing", style: "venom", mass: 999 },
  ])
    assert.equal(getVehicleProfile(bad), VEHICLE_PROFILES.jeep);
});
test("sports accelerate and travel faster; heavy bodies retain a distinct tradeoff", () => {
  const light = VEHICLE_PROFILES.solstice,
    heavy = VEHICLE_PROFILES.monster;
  assert.ok(simulate(light, 1).speed > simulate(heavy, 1).speed * 1.5);
  assert.ok(simulate(light, 5).distance > simulate(heavy, 5).distance * 1.5);
  for (const profile of Object.values(VEHICLE_PROFILES)) {
    assert.equal(simulate(profile, 15).speed, profile.topSpeed);
    assert.equal(
      simulate(profile, 15, 60, { throttle: 1, boost: true }).speed,
      profile.boostSpeed,
    );
    const moving = advanceDriveSpeed(
      profile.topSpeed,
      { brake: true },
      0.5,
      profile,
    );
    assert.ok(moving < profile.topSpeed * 0.04, "braking responds immediately");
    assert.ok(advanceDriveSpeed(0, { throttle: -1 }, 10, profile) >= -5);
  }
});
test("acceleration and steering response agree across frame rates", () => {
  for (const profile of Object.values(VEHICLE_PROFILES)) {
    const reference = simulate(profile, 0.5, 120).speed;
    for (const fps of [30, 60])
      assert.ok(Math.abs(simulate(profile, 0.5, fps).speed - reference) < 1e-9);
    const steer = (fps) => {
      let value = 0;
      for (let i = 0; i < fps / 2; i++)
        value = smoothSteering(value, 1, 1 / fps, profile);
      return value;
    };
    assert.ok(Math.abs(steer(30) - steer(120)) < 1e-9);
  }
  assert.ok(
    smoothSteering(0, 1, 0.05, VEHICLE_PROFILES.formula) >
      smoothSteering(0, 1, 0.05, VEHICLE_PROFILES.muscle),
  );
});
test("environment bumpers launch light cars farther without weakening jump-pad clearance", () => {
  const light = obstacleResponse(10, 3.5, VEHICLE_PROFILES.formula);
  const heavy = obstacleResponse(10, 3.5, VEHICLE_PROFILES.monster);
  assert.ok(light.speed > heavy.speed * 1.5);
  assert.ok(light.jumpVelocity > heavy.jumpVelocity);
  assert.ok(light.speed < 22);
  assert.deepEqual(obstacleResponse(10, 3.5, VEHICLE_PROFILES.jeep), {
    speed: 10,
    jumpVelocity: 3.5,
  });
});
