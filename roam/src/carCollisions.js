export const CAR_CONTACT = Object.freeze({
  radius: 1.5,
  cooldown: 700,
  immunity: 500,
  stale: 450,
  // Field contacts are three times the former quarter-bumper response.
  // Scale the floor and cap too, preserving light/heavy momentum sharing.
  bumperImpulse: 10,
  bumperFraction: 0.75,
  referenceClosingSpeed: 7,
  minImpulse: 3.3,
  maxImpulse: 12,
});
export const ARENA_CAR_CONTACT = Object.freeze({
  minImpulse: 1.8,
  closingFactor: 0.9,
  maxImpulse: 14,
});
export const SOCCER_CAR_CONTACT = Object.freeze({
  minImpulse: 5.5,
  closingFactor: 1.15,
  maxImpulse: 14,
});

// Swept contact avoids skipping a car between the room's 80 ms pose updates.
// This is shared math; only the server is allowed to publish an impact.
export function carContact(
  previous,
  current,
  other,
  velocity,
  otherVelocity = { x: 0, z: 0 },
  profile = { mass: 1, bounce: 1 },
  otherProfile = { mass: 1, bounce: 1 },
  options = {},
) {
  const dx = current.x - previous.x,
    dz = current.z - previous.z;
  const square = dx * dx + dz * dz;
  const ox = previous.x - other.x,
    oz = previous.z - other.z;
  const c = ox * ox + oz * oz - CAR_CONTACT.radius ** 2;
  let t = 0;
  if (c > 0) {
    const b = 2 * (ox * dx + oz * dz);
    const discriminant = b * b - 4 * square * c;
    if (square < 1e-8 || discriminant < 0) return null;
    t = (-b - Math.sqrt(discriminant)) / (2 * square);
    if (t < 0 || t > 1) return null;
  }
  const x = previous.x + dx * t,
    z = previous.z + dz * t;
  const y = (previous.y || 0) + ((current.y || 0) - (previous.y || 0)) * t;
  if (Math.abs(y - (other.y || 0)) > 0.75) return null;
  let nx = other.x - x,
    nz = other.z - z;
  let length = Math.hypot(nx, nz);
  if (length < 0.01) {
    nx = other.x - previous.x;
    nz = other.z - previous.z;
    length = Math.hypot(nx, nz);
  }
  if (length < 0.01) return null;
  nx /= length;
  nz /= length;
  const closing =
    (velocity.x - otherVelocity.x) * nx + (velocity.z - otherVelocity.z) * nz;
  if (!Number.isFinite(closing) || closing < 0.65) return null;
  const bounded = (value, min, max) =>
    Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : 1;
  const massA = bounded(profile.mass, 0.7, 1.8);
  const massB = bounded(otherProfile.mass, 0.7, 1.8);
  const bounce = Math.sqrt(
    bounded(profile.bounce, 0.68, 1.3) *
      bounded(otherProfile.bounce, 0.68, 1.3),
  );
  // Match strength is selected by the server's current match membership,
  // never by a client-supplied mass, cosmetic or impact message.
  const response =
    options.mode === "arena"
      ? ARENA_CAR_CONTACT
      : options.mode === "soccer"
        ? SOCCER_CAR_CONTACT
        : CAR_CONTACT;
  const closingFactor =
    response.closingFactor ??
    (response.bumperImpulse * response.bumperFraction) /
      response.referenceClosingSpeed;
  const impulse = Math.min(
    response.maxImpulse,
    Math.max(response.minImpulse, closing * closingFactor * bounce),
  );
  // Equal masses receive opposite impulses. Scale both sides together at
  // the safety cap so heavy/light momentum remains balanced at hard impacts.
  const shareA = (2 * massB) / (massA + massB);
  const shareB = (2 * massA) / (massA + massB);
  const scale = Math.min(
    1,
    response.maxImpulse / (impulse * Math.max(shareA, shareB)),
  );
  const impulseA = impulse * shareA * scale;
  const impulseB = impulse * shareB * scale;
  const side =
    Math.sin(current.heading || 0) * nz - Math.cos(current.heading || 0) * nx;
  const spin =
    (Math.abs(side) > 0.15 ? Math.sign(side) : 1) *
    Math.min(2.8, 0.3 + impulse * 0.2);
  return {
    x: (x + other.x) / 2,
    z: (z + other.z) / 2,
    strength: Math.max(impulseA, impulseB) / response.maxImpulse,
    a: {
      vx: -nx * impulseA,
      vz: -nz * impulseA,
      spin: Math.sign(spin) * Math.min(2.8, Math.abs(spin) * shareA * scale),
    },
    b: {
      vx: nx * impulseB,
      vz: nz * impulseB,
      spin: -Math.sign(spin) * Math.min(2.8, Math.abs(spin) * shareB * scale),
    },
  };
}

export function movementVelocity(previous, current, elapsed) {
  if (elapsed < 0.015 || elapsed > CAR_CONTACT.stale / 1000)
    return { x: 0, z: 0 };
  const x = (current.x - previous.x) / elapsed,
    z = (current.z - previous.z) / elapsed;
  const scale = Math.min(1, 24 / (Math.hypot(x, z) || 1));
  return { x: x * scale, z: z * scale };
}
