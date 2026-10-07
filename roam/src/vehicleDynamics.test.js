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
test("all 18 shapes have bounded shared stats and paint never changes performance", () => {
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
    assert.ok(profile.mass >= 0.7 && profile.mass <= 1.8);
    assert.ok(profile.bounce >= 0.68 && profile.bounce <= 1.3);
    assert.ok(profile.boostSpeed <= 16.6);
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

test("new mythic motorcycle, wedge and luxury sedan retain distinct handling within server bounds", () => {
  const bike = getVehicleProfile("body-mythic-zephyr");
  const supercar = getVehicleProfile("body-mythic-astra");
  const sedan = getVehicleProfile("body-mythic-regal");
  assert.equal(bike, VEHICLE_PROFILES.motorbike);
  assert.equal(supercar, VEHICLE_PROFILES.wedge);
  assert.equal(sedan, VEHICLE_PROFILES.limousine);
  assert.ok(simulate(bike, 0.5).speed > simulate(supercar, 0.5).speed);
  assert.ok(simulate(bike, 0.5).speed > simulate(sedan, 0.5).speed * 1.5);
  assert.ok(simulate(supercar, 10).distance > simulate(bike, 10).distance);
  assert.ok(
    bike.steering > supercar.steering && supercar.steering > sedan.steering,
  );
  assert.ok(sedan.mass > bike.mass * 2 && sedan.grip > bike.grip);
  assert.ok(
    obstacleResponse(10, 3.5, bike).speed >
      obstacleResponse(10, 3.5, sedan).speed,
  );
  for (const profile of [bike, supercar, sedan]) {
    assert.ok(obstacleResponse(10, 3.5, profile).speed < 22);
    assert.equal(
      simulate(profile, 15, 60, { throttle: 1, boost: true }).speed,
      profile.boostSpeed,
    );
  }
  assert.equal(
    getVehicleProfile({
      id: "body-mythic-zephyr",
      style: "limousine",
      mass: 999,
    }),
    bike,
    "only the saved canonical body selects physics",
  );
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
