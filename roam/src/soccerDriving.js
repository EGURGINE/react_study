import { SOCCER, clampSoccerPose } from "./soccerConfig.js";

export const SOCCER_IMPACT_DRAG = 3;

export function soccerNavigationSpeed(distance, turn, profile, boost = false) {
  const limit = boost ? profile.boostSpeed : profile.topSpeed;
  return (
    Math.min(limit, (Math.max(0, distance) * 3.2 * profile.acceleration) / 9) *
    Math.max(0.1, Math.cos(turn))
  );
}

/** Reflect only the wall-normal velocity; a glancing touch must not brake steering. */
export function resolveSoccerWall({
  x,
  z,
  vx,
  vz,
  speed,
  heading,
  impactX,
  impactZ,
}) {
  const bounded = clampSoccerPose(x, z);
  const hitX = bounded.x !== x;
  const hitZ = bounded.z !== z;
  if (hitX && vx * (x - SOCCER.cx) > 0)
    impactX = -vx * 0.35 - Math.sin(heading) * speed;
  if (hitZ && vz * (z - SOCCER.cz) > 0)
    impactZ = -vz * 0.35 - Math.cos(heading) * speed;
  return { ...bounded, impactX, impactZ, hit: hitX || hitZ };
}

/** A server impulse briefly interrupts drive into a car, while preserving tangential motion. */
export function applySoccerCarImpulse(
  { speed, heading, impactX, impactZ },
  push,
) {
  const magnitude = Math.hypot(push.vx, push.vz);
  if (!Number.isFinite(magnitude) || magnitude < 1e-8)
    return { speed, impactX, impactZ };
  const nx = push.vx / magnitude,
    nz = push.vz / magnitude;
  const fx = Math.sin(heading),
    fz = Math.cos(heading);
  const normal = (fx * nx + fz * nz) * speed;
  // Unlike blanket speed damping, this does nothing to a perpendicular strike.
  // The impulse cap also lets a heavy car rebound visibly from a lighter one.
  const retainedNormal =
    normal < 0 ? -Math.min(-normal * 0.5, magnitude * 0.45) : normal;
  const retainedX = fx * speed + nx * (retainedNormal - normal);
  const retainedZ = fz * speed + nz * (retainedNormal - normal);
  const nextSpeed = retainedX * fx + retainedZ * fz;
  impactX += push.vx + retainedX - fx * nextSpeed;
  impactZ += push.vz + retainedZ - fz * nextSpeed;
  const scale = Math.min(
    1,
    SOCCER.maxCarSpeed / (Math.hypot(impactX, impactZ) || 1),
  );
  return {
    speed: nextSpeed,
    impactX: impactX * scale,
    impactZ: impactZ * scale,
  };
}
