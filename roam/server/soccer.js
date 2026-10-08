import { randomUUID } from "node:crypto";
import {
  SOCCER,
  SOCCER_TEAMS,
  soccerBall,
  soccerSpawn,
  isSoccerDriveable,
} from "../src/soccerConfig.js";

const STEP = 1 / 120;
const WAIT_MS = 10 * 60_000;
const PLAY_MS = 15 * 60_000;
const HIT_COOLDOWN_MS = 140;

const capBall = (ball) => {
  const scale = Math.min(
    1,
    SOCCER.maxBallSpeed / (Math.hypot(ball.vx, ball.vz) || 1),
  );
  ball.vx *= scale;
  ball.vz *= scale;
};

/** A tiny bounded step is also the goal-line sweep: no fast ball skips a wall. */
export function stepSoccerBall(ball, dt) {
  ball.vx *= Math.exp(-0.16 * dt);
  ball.vz *= Math.exp(-0.16 * dt);
  capBall(ball);
  ball.x += ball.vx * dt;
  ball.z += ball.vz * dt;
  ball.vy -= 13 * dt;
  ball.y += ball.vy * dt;
  if (ball.y < SOCCER.ballRadius) {
    ball.y = SOCCER.ballRadius;
    ball.vy = Math.abs(ball.vy) > 1.1 ? Math.abs(ball.vy) * 0.58 : 0;
  }
  const zBound = SOCCER.halfWidth - SOCCER.ballRadius;
  const dz = ball.z - SOCCER.cz;
  if (Math.abs(dz) > zBound) {
    ball.z = SOCCER.cz + Math.sign(dz) * (2 * zBound - Math.abs(dz));
    ball.vz = -Math.sign(dz) * Math.abs(ball.vz) * 0.94;
  }
  const dx = ball.x - SOCCER.cx;
  const mouth =
    Math.abs(ball.z - SOCCER.cz) <= SOCCER.goalHalfWidth - SOCCER.ballRadius &&
    ball.y <= SOCCER.goalHeight - SOCCER.ballRadius;
  if (mouth && Math.abs(dx) >= SOCCER.halfLength + SOCCER.ballRadius)
    return dx > 0 ? "blue" : "orange";
  const xBound = SOCCER.halfLength - SOCCER.ballRadius;
  if (!mouth && Math.abs(dx) > xBound) {
    // The solid end wall includes the posts and crossbar. Keep a ball that
    // leaves the mouth during a step on the playable side of that wall.
    ball.x =
      SOCCER.cx + Math.sign(dx) * Math.min(xBound, 2 * xBound - Math.abs(dx));
    ball.vx = -Math.sign(dx) * Math.abs(ball.vx) * 0.94;
  }
  return null;
}

export function createSoccerController({
  peers,
  resetLap,
  teleport,
  broadcast,
  now,
  fail,
  hasOtherGame,
}) {
  let match = null;
  const cars = new Map();
  const hits = new Map();
  let lastTick = 0;
  let lastBroadcast = -Infinity;
  const visible = (value = match) =>
    value
      ? {
          id: value.id,
          hostId: value.hostId,
          status: value.status,
          players: value.players.map(({ id, nickname, team }) => ({
            id,
            nickname,
            team,
          })),
          scores: { ...value.scores },
          ball: { ...value.ball },
          startsAt: value.startsAt,
          goalTeam: value.goalTeam,
          sequence: value.sequence,
        }
      : null;
  const snapshot = () => visible();
  const has = (id) =>
    Boolean(match?.players.some((player) => player.id === id));
  const soccerFor = (id) => (has(id) ? snapshot() : null);
  const publish = () => {
    lastBroadcast = now();
    broadcast({ type: "soccer:state", soccer: snapshot() });
  };
  const restore = (player) => {
    const peer = peers.get(player.id);
    resetLap(player.id);
    cars.delete(player.id);
    hits.delete(player.id);
    if (!peer || !player.returnPose) return;
    Object.assign(peer.player, player.returnPose);
    teleport(player.id, { ...player.returnPose });
  };
  function finish(winnerTeam, reason) {
    if (!match) return;
    const completed = match;
    match = null;
    for (const player of completed.players) restore(player);
    cars.clear();
    hits.clear();
    publish();
    broadcast({
      type: "soccer:finish",
      result: {
        soccerId: completed.id,
        participantIds:
          completed.participantIds ||
          completed.players.map((player) => player.id),
        winnerTeam,
        scores: { ...completed.scores },
        reason,
      },
    });
  }
  function kickoff(time) {
    match.ball = soccerBall();
    match.goalTeam = null;
    match.sequence += 1;
    cars.clear();
    hits.clear();
    for (const team of SOCCER_TEAMS) {
      const players = match.players.filter((player) => player.team === team);
      for (const [index, player] of players.entries()) {
        const peer = peers.get(player.id);
        const pose = soccerSpawn(index, players.length, team);
        if (!peer) continue;
        resetLap(player.id);
        Object.assign(peer.player, pose);
        cars.set(player.id, { ...pose, vx: 0, vz: 0, at: time });
        teleport(player.id, pose);
      }
    }
    lastTick = time;
  }
  function leave(id, reason = "team_empty") {
    if (!has(id)) return;
    if (match.players.length === 1)
      return finish(null, match.status === "waiting" ? "cancelled" : reason);
    const departing = match.players.find((player) => player.id === id);
    restore(departing);
    match.players = match.players.filter((player) => player.id !== id);
    if (
      match.status !== "waiting" &&
      SOCCER_TEAMS.some(
        (team) => !match.players.some((player) => player.team === team),
      )
    )
      return finish(null, reason);
    if (match.hostId === id) match.hostId = match.players[0].id;
    publish();
  }
  function plan(id, data, time) {
    if (data.action === "soccer:create") {
      if (has(id) || hasOtherGame(id))
        fail("이미 참가 중인 경기가 있어요.", "already_racing");
      if (match)
        fail(
          "축구 대기방이 이미 열려 있어요. 팀을 선택해 참가해 주세요.",
          "soccer_busy",
        );
      const created = {
        id: randomUUID(),
        hostId: id,
        status: "waiting",
        players: [
          {
            id,
            nickname: peers.get(id).player.nickname,
            team: "blue",
            returnPose: null,
          },
        ],
        scores: { blue: 0, orange: 0 },
        ball: soccerBall(),
        startsAt: null,
        goalTeam: null,
        sequence: 0,
        expiresAt: time + WAIT_MS,
      };
      return {
        details: { soccer: visible(created) },
        effect: () => {
          match = created;
          publish();
        },
      };
    }
    if (!match || data.soccerId !== match.id)
      fail("참가할 수 없는 축구 경기예요.", "soccer_unavailable");
    if (data.action === "soccer:join" || data.action === "soccer:team") {
      if (!SOCCER_TEAMS.includes(data.team))
        fail("블루 또는 오렌지 팀을 선택해 주세요.", "invalid_team");
      if (match.status !== "waiting")
        fail("이미 시작된 경기예요.", "soccer_started");
      if (data.action === "soccer:join") {
        if (has(id) || hasOtherGame(id))
          fail("이미 참가 중인 경기가 있어요.", "already_racing");
        if (match.players.length >= SOCCER.maxPlayers)
          fail("축구 참가 인원이 가득 찼어요.", "soccer_full");
      } else if (!has(id))
        fail("먼저 팀에 참가해 주세요.", "soccer_unavailable");
      const changed = {
        ...match,
        players:
          data.action === "soccer:join"
            ? [
                ...match.players,
                {
                  id,
                  nickname: peers.get(id).player.nickname,
                  team: data.team,
                  returnPose: null,
                },
              ]
            : match.players.map((player) =>
                player.id === id ? { ...player, team: data.team } : player,
              ),
      };
      return {
        details: { soccer: visible(changed) },
        effect: () => {
          match = changed;
          publish();
        },
      };
    }
    if (!has(id)) fail("참가 중인 축구 경기가 아니에요.", "soccer_unavailable");
    if (data.action === "soccer:start") {
      if (match.hostId !== id || match.status !== "waiting")
        fail("방장만 대기 중인 경기를 시작할 수 있어요.", "soccer_not_host");
      if (
        SOCCER_TEAMS.some(
          (team) => !match.players.some((player) => player.team === team),
        )
      )
        fail("양 팀에 한 명 이상 모이면 시작할 수 있어요.", "soccer_not_ready");
      const started = {
        ...match,
        status: "countdown",
        startsAt: time + SOCCER.countdownMs,
        expiresAt: time + SOCCER.countdownMs + PLAY_MS,
        participantIds: match.players.map((player) => player.id),
        players: match.players.map((player) => {
          const { x, y = 0, z, heading } = peers.get(player.id).player;
          return { ...player, returnPose: { x, y, z, heading } };
        }),
        sequence: match.sequence + 1,
      };
      return {
        details: { soccer: visible(started) },
        effect: () => {
          match = started;
          // kickoff increments the sequence once; the planned response already
          // contains that value for clients receiving the request result first.
          match.sequence -= 1;
          kickoff(time);
          publish();
        },
      };
    }
    if (data.action === "soccer:leave")
      return { details: {}, effect: () => leave(id) };
    fail("지원하지 않는 축구 요청이에요.", "invalid_game");
  }
  function hitCar(id, car, time) {
    if (!match || match.status !== "playing") return;
    const ball = match.ball;
    if (Math.abs(ball.y - ((car.y || 0) + 0.5)) > 1.45) return;
    let nx = ball.x - car.x;
    let nz = ball.z - car.z;
    let distance = Math.hypot(nx, nz);
    const contactRadius = SOCCER.ballRadius + SOCCER.carRadius;
    if (distance > contactRadius) return;
    if (distance < 0.001) {
      nx = Math.sin(car.heading || 0);
      nz = Math.cos(car.heading || 0);
      distance = 1;
    }
    nx /= distance;
    nz /= distance;
    ball.x = car.x + nx * (contactRadius + 0.015);
    ball.z = car.z + nz * (contactRadius + 0.015);
    if (time - (hits.get(id) ?? -Infinity) < HIT_COOLDOWN_MS) return;
    const vx = car.vx || 0;
    const vz = car.vz || 0;
    const closing = (vx - ball.vx) * nx + (vz - ball.vz) * nz;
    if (closing < 0.2) return;
    const kick = Math.max(8, closing * 1.85 + Math.hypot(vx, vz) * 0.4);
    ball.vx += nx * kick;
    ball.vz += nz * kick;
    ball.vy = Math.max(ball.vy, Math.min(5.5, 2 + closing * 0.1));
    capBall(ball);
    hits.set(id, time);
  }
  function observe(id, pose) {
    if (!has(id) || match.status === "waiting") return false;
    if (match.status !== "playing") return true;
    const time = now();
    const previous = cars.get(id) || { ...pose, at: time, vx: 0, vz: 0 };
    const dt = (time - previous.at) / 1000;
    let vx = dt >= 0.015 && dt <= 0.5 ? (pose.x - previous.x) / dt : 0;
    let vz = dt >= 0.015 && dt <= 0.5 ? (pose.z - previous.z) / dt : 0;
    const scale = Math.min(1, SOCCER.maxCarSpeed / (Math.hypot(vx, vz) || 1));
    vx *= scale;
    vz *= scale;
    const current = { ...pose, vx, vz, at: time };
    if (isSoccerDriveable(pose.x, pose.z)) {
      const dx = pose.x - previous.x;
      const dz = pose.z - previous.z;
      const square = dx * dx + dz * dz;
      const t = square
        ? Math.max(
            0,
            Math.min(
              1,
              ((match.ball.x - previous.x) * dx +
                (match.ball.z - previous.z) * dz) /
                square,
            ),
          )
        : 1;
      // Accepted car motion is swept against the ball, including 80 ms updates.
      hitCar(
        id,
        {
          ...current,
          x: previous.x + dx * t,
          z: previous.z + dz * t,
          y: (previous.y || 0) + ((pose.y || 0) - (previous.y || 0)) * t,
        },
        time,
      );
      cars.set(id, current);
    }
    return true;
  }
  function tick() {
    if (!match) return;
    const time = now();
    if (time >= match.expiresAt) return finish(null, "timeout");
    if (match.status === "waiting") return;
    if (match.status === "countdown" || match.status === "goal") {
      if (time < match.startsAt) return;
      if (match.status === "goal") kickoff(time);
      match.status = "playing";
      lastTick = time;
      publish();
      return;
    }
    const duration = Math.min(0.5, Math.max(0, (time - lastTick) / 1000));
    if (!duration) return;
    lastTick = time;
    let elapsed = 0;
    while (elapsed < duration && match?.status === "playing") {
      const dt = Math.min(STEP, duration - elapsed);
      elapsed += dt;
      for (const player of match.players) {
        const car = cars.get(player.id);
        if (!car) continue;
        const fresh = time - car.at <= 250;
        hitCar(player.id, fresh ? car : { ...car, vx: 0, vz: 0 }, time);
      }
      const team = stepSoccerBall(match.ball, dt);
      if (team) {
        match.scores[team] += 1;
        match.goalTeam = team;
        match.status = "goal";
        match.startsAt = time + SOCCER.goalPauseMs;
        match.ball.vx = match.ball.vy = match.ball.vz = 0;
        if (match.scores[team] >= SOCCER.winningScore)
          return finish(team, "goals");
        publish();
        return;
      }
    }
    if (time - lastBroadcast >= 65) publish();
  }
  return {
    plan,
    tick,
    observe,
    snapshot,
    has,
    soccerFor,
    canMove: (id) =>
      !has(id) || match.status === "waiting" || match.status === "playing",
    detach: (id) => leave(id),
    shutdown: () => finish(null, "server_restart"),
  };
}
