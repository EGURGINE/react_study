export const SOCCER = Object.freeze({
  cx: 70,
  cz: -5,
  halfLength: 20,
  halfWidth: 12,
  goalHalfWidth: 4,
  goalDepth: 3,
  goalHeight: 3.6,
  ballRadius: 0.85,
  carRadius: 0.8,
  maxPlayers: 10,
  winningScore: 3,
  maxCarSpeed: 24,
  maxBallSpeed: 38,
  countdownMs: 3000,
  goalPauseMs: 1800,
});

export const SOCCER_TEAMS = Object.freeze(["blue", "orange"]);

// Cars stay on the rectangular pitch; only the ball enters the recessed goals.
export function isSoccerDriveable(x, z, margin = 0) {
  return (
    Number.isFinite(x) &&
    Number.isFinite(z) &&
    Math.abs(x - SOCCER.cx) <= SOCCER.halfLength + margin &&
    Math.abs(z - SOCCER.cz) <= SOCCER.halfWidth + margin
  );
}

export function clampSoccerPose(x, z) {
  const length = SOCCER.halfLength - SOCCER.carRadius;
  const width = SOCCER.halfWidth - SOCCER.carRadius;
  return {
    x: SOCCER.cx + Math.max(-length, Math.min(length, x - SOCCER.cx)),
    z: SOCCER.cz + Math.max(-width, Math.min(width, z - SOCCER.cz)),
  };
}

export function soccerSpawn(index, teamCount, team) {
  if (
    !SOCCER_TEAMS.includes(team) ||
    !Number.isInteger(teamCount) ||
    teamCount < 1 ||
    teamCount > SOCCER.maxPlayers ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= teamCount
  )
    throw new RangeError("Invalid soccer team spawn");
  const sign = team === "blue" ? -1 : 1;
  const row = Math.floor(index / 5);
  const count = Math.min(5, teamCount - row * 5);
  return {
    x: SOCCER.cx + sign * (8 + row * 5),
    y: 0,
    z: SOCCER.cz + ((index % 5) - (count - 1) / 2) * 3.4,
    heading: team === "blue" ? Math.PI / 2 : -Math.PI / 2,
  };
}

export function soccerBall() {
  return {
    x: SOCCER.cx,
    y: SOCCER.ballRadius,
    z: SOCCER.cz,
    vx: 0,
    vy: 0,
    vz: 0,
  };
}
