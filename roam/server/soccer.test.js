import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGameEngine } from "./game.js";
import { stepSoccerBall } from "./soccer.js";
import {
  SOCCER,
  soccerBall,
  soccerSpawn,
  isSoccerDriveable,
  clampSoccerPose,
} from "../src/soccerConfig.js";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "roam-soccer-"));
  let time = 1_800_000_000_000;
  const events = [];
  const teleports = [];
  const game = createGameEngine({
    directory,
    now: () => time,
    random: () => 0,
    broadcast: (event) => events.push(event),
    teleport: (id, pose) => teleports.push({ id, pose }),
  });
  t.after(() => {
    game.shutdown();
    rmSync(directory, { recursive: true, force: true });
  });
  const attach = () => {
    const player = {
      id: randomUUID(),
      nickname: `축구${Math.floor(Math.random() * 100000)}`,
      x: 1,
      y: 0,
      z: 7,
      heading: 0,
    };
    const identity = game.attach(player);
    return { player, ...identity };
  };
  const action = (user, action, values = {}, requestId = randomUUID()) =>
    game.handle(user.player.id, { type: "game", action, requestId, ...values });
  const advance = (ms, ticking = true) => {
    time += ms;
    if (ticking) game.tick();
  };
  const pose = (user, x, z, ms = 80) => {
    advance(ms);
    Object.assign(user.player, { x, z, y: 0 });
    game.onMove(user.player.id, user.player);
  };
  const lobby = (blueCount = 1, orangeCount = 1) => {
    const users = Array.from({ length: blueCount + orangeCount }, attach);
    const created = action(users[0], "soccer:create");
    assert.equal(created.ok, true);
    const soccerId = created.soccer.id;
    for (let i = 1; i < users.length; i += 1)
      assert.equal(
        action(users[i], "soccer:join", {
          soccerId,
          team: i < blueCount ? "blue" : "orange",
        }).ok,
        true,
      );
    return { users, soccerId };
  };
  return { game, events, teleports, attach, action, advance, pose, lobby };
}

test("soccer geometry supports one through nine players per team inside the isolated pitch", () => {
  for (const team of ["blue", "orange"])
    for (let count = 1; count <= 9; count += 1) {
      const poses = Array.from({ length: count }, (_, index) =>
        soccerSpawn(index, count, team),
      );
      assert.equal(
        new Set(poses.map((pose) => `${pose.x},${pose.z}`)).size,
        count,
      );
      for (const pose of poses) {
        assert.equal(
          isSoccerDriveable(pose.x, pose.z, -SOCCER.carRadius),
          true,
        );
        assert.equal(Math.sign(pose.x - SOCCER.cx), team === "blue" ? -1 : 1);
      }
    }
  assert.equal(isSoccerDriveable(0, 0), false);
  assert.equal(isSoccerDriveable(NaN, 0), false);
  const clamped = clampSoccerPose(1000, -1000);
  assert.equal(
    isSoccerDriveable(clamped.x, clamped.z, -SOCCER.carRadius + 1e-6),
    true,
  );
});

test("free lobbies allow 1v1, 3v3 and uneven teams up to ten players", (t) => {
  const room = fixture(t);
  for (const [blue, orange] of [
    [1, 1],
    [3, 3],
    [7, 3],
  ]) {
    const { users, soccerId } = room.lobby(blue, orange);
    assert.equal(room.game.snapshotSoccer().players.length, blue + orange);
    assert.equal(room.action(users[0], "soccer:start", { soccerId }).ok, true);
    assert.equal(room.game.snapshotSoccer().status, "countdown");
    assert.equal(room.game.canMove(users[0].player.id), false);
    assert.equal(room.game.beforeTeleport(users[0].player.id), false);
    room.advance(SOCCER.countdownMs);
    assert.equal(room.game.snapshotSoccer().status, "playing");
    assert.equal(room.game.canMove(users[0].player.id), true);
    for (const user of users)
      assert.equal(room.game.profile(user.player.id).coins, 0);
    for (const user of users) room.game.detach(user.player.id);
    assert.equal(room.game.snapshotSoccer(), null);
  }
});

test("only the host can start, both teams are required, and team switching stops at kickoff", (t) => {
  const room = fixture(t);
  const host = room.attach();
  const guest = room.attach();
  const soccerId = room.action(host, "soccer:create").soccer.id;
  assert.equal(
    room.action(host, "soccer:start", { soccerId }).code,
    "soccer_not_ready",
  );
  assert.equal(
    room.action(guest, "soccer:join", { soccerId, team: "green" }).code,
    "invalid_team",
  );
  assert.equal(
    room.action(guest, "soccer:join", { soccerId, team: "blue" }).ok,
    true,
  );
  assert.equal(
    room.action(guest, "soccer:start", { soccerId }).code,
    "soccer_not_host",
  );
  assert.equal(
    room.action(host, "soccer:start", { soccerId }).code,
    "soccer_not_ready",
  );
  assert.equal(
    room.action(guest, "soccer:team", { soccerId, team: "orange" }).ok,
    true,
  );
  assert.equal(room.action(host, "soccer:start", { soccerId }).ok, true);
  assert.equal(
    room.action(guest, "soccer:team", { soccerId, team: "blue" }).code,
    "soccer_started",
  );
  assert.equal(
    room.action(room.attach(), "soccer:join", { soccerId, team: "blue" }).code,
    "soccer_started",
  );
});

test("capacity, one lobby, forged teams, scores, balls and requests never alter authoritative play", (t) => {
  const room = fixture(t);
  const { users, soccerId } = room.lobby(9, 1);
  const extra = room.attach();
  assert.equal(
    room.action(extra, "soccer:join", { soccerId, team: "orange" }).code,
    "soccer_full",
  );
  assert.equal(room.action(extra, "soccer:create").code, "soccer_busy");
  for (const values of [
    { scores: { blue: 3 } },
    { ball: soccerBall() },
    { winnerTeam: "blue" },
    { stake: 1 },
    { x: 70 },
  ])
    assert.equal(
      room.action(users[0], "soccer:start", { soccerId, ...values }).code,
      "invalid_game",
    );
  assert.equal(
    room.action(extra, "soccer:goal", { soccerId }).code,
    "invalid_game",
  );
  assert.equal(
    room.action({ player: { id: "outsider" } }, "soccer:create").code,
    "not_joined",
  );
  const snapshot = room.game.snapshotSoccer();
  snapshot.ball.vx = 9999;
  snapshot.players[0].team = "orange";
  assert.equal(room.game.snapshotSoccer().ball.vx, 0);
  assert.equal(room.game.snapshotSoccer().players[0].team, "blue");
});

test("soccer excludes race and arena memberships and locks owned bodies without charging coins", (t) => {
  const room = fixture(t);
  const host = room.attach();
  const other = room.attach();
  const vehicle = room.action(host, "attendance:claim").item;
  room.advance(1000);
  const soccerId = room.action(host, "soccer:create").soccer.id;
  assert.equal(
    room.action(host, "race:create", { stake: 20 }).code,
    "already_racing",
  );
  assert.equal(room.action(host, "arena:create").code, "already_racing");
  assert.equal(
    room.action(host, "equip", { itemId: vehicle.id }).code,
    "race_body_locked",
  );
  assert.equal(room.action(host, "soccer:leave", { soccerId }).ok, true);
  assert.equal(room.action(host, "equip", { itemId: vehicle.id }).ok, true);
  room.advance(86400000);
  room.action(host, "attendance:claim");
  const arena = room.action(host, "arena:create");
  assert.equal(arena.ok, true);
  const nextSoccerId = room.action(other, "soccer:create").soccer.id;
  assert.equal(
    room.action(host, "soccer:join", { soccerId: nextSoccerId, team: "orange" })
      .code,
    "already_racing",
  );
  room.action(host, "arena:leave", { arenaId: arena.arena.id });
  const race = room.action(host, "race:create", { stake: 20 });
  assert.equal(race.ok, true);
  assert.equal(
    room.action(host, "soccer:join", { soccerId: nextSoccerId, team: "orange" })
      .code,
    "already_racing",
  );
});

test("a departing host transfers the waiting room, while a vanished playing team cancels with no winner", (t) => {
  const room = fixture(t);
  const { users, soccerId } = room.lobby(2, 2);
  const homes = users.map((user) => ({ ...user.player }));
  assert.equal(room.action(users[0], "soccer:leave", { soccerId }).ok, true);
  assert.equal(room.game.snapshotSoccer().hostId, users[1].player.id);
  assert.equal(room.action(users[1], "soccer:start", { soccerId }).ok, true);
  room.advance(SOCCER.countdownMs);
  room.game.detach(users[2].player.id);
  assert.equal(room.game.snapshotSoccer().status, "playing");
  assert.equal(room.game.snapshotSoccer().players.length, 2);
  room.game.detach(users[3].player.id);
  assert.equal(room.game.snapshotSoccer(), null);
  const result = room.events
    .filter((event) => event.type === "soccer:finish")
    .at(-1).result;
  assert.equal(result.winnerTeam, null);
  assert.equal(result.reason, "team_empty");
  assert.equal(users[1].player.x, homes[1].x);
  assert.equal(users[1].player.z, homes[1].z);
});

test("request replay never starts or joins twice and stopped phases cannot move the ball", (t) => {
  const room = fixture(t);
  const host = room.attach();
  const guest = room.attach();
  const created = room.action(host, "soccer:create", {}, "create-once");
  assert.equal(
    room.action(host, "soccer:create", {}, "create-once").soccer.id,
    created.soccer.id,
  );
  const soccerId = created.soccer.id;
  room.action(guest, "soccer:join", { soccerId, team: "orange" }, "join-once");
  room.action(guest, "soccer:join", { soccerId, team: "orange" }, "join-once");
  assert.equal(room.game.snapshotSoccer().players.length, 2);
  room.action(host, "soccer:start", { soccerId }, "start-once");
  room.action(host, "soccer:start", { soccerId }, "start-once");
  assert.equal(room.teleports.length, 2);
  for (let i = 0; i < 5; i += 1) room.game.tick();
  assert.deepEqual(room.game.snapshotSoccer().ball, soccerBall());
  assert.equal(room.game.snapshotSoccer().sequence, 1);
  assert.equal(room.game.canMove(host.player.id), false);
});

test("ball substeps preserve wall rebound, high-speed goals, crossbars and slow rolling", () => {
  const wall = { ...soccerBall(), z: SOCCER.cz + 10, vz: 38 };
  for (let i = 0; i < 50; i += 1)
    assert.equal(stepSoccerBall(wall, 1 / 120), null);
  assert.ok(wall.vz < -30);
  assert.ok(
    Math.abs(wall.z - SOCCER.cz) < SOCCER.halfWidth - SOCCER.ballRadius,
  );
  for (const sign of [-1, 1]) {
    const fast = { ...soccerBall(), x: SOCCER.cx + sign * 18, vx: sign * 38 };
    let goal;
    for (let i = 0; i < 30 && !goal; i += 1)
      goal = stepSoccerBall(fast, 1 / 120);
    assert.equal(goal, sign > 0 ? "blue" : "orange");
  }
  for (const values of [{ z: SOCCER.cz + 4.1 }, { y: SOCCER.goalHeight + 1 }]) {
    const missed = { ...soccerBall(), x: SOCCER.cx + 18, vx: 38, ...values };
    for (let i = 0; i < 30; i += 1)
      assert.equal(stepSoccerBall(missed, 1 / 120), null);
    assert.ok(missed.vx < 0);
  }
  const rolling = { ...soccerBall(), vx: 5, z: SOCCER.cz + 6 };
  for (let i = 0; i < 120; i += 1) stepSoccerBall(rolling, 1 / 120);
  assert.ok(rolling.vx > 4 && rolling.vx < 5);
});

test("accepted car hits produce three single goals, frozen celebrations, kickoff resets and return poses", (t) => {
  const room = fixture(t);
  const {
    users: [blue, orange],
    soccerId,
  } = room.lobby();
  const homes = [blue, orange].map((user) => ({
    x: user.player.x,
    z: user.player.z,
  }));
  room.action(blue, "soccer:start", { soccerId });
  room.advance(SOCCER.countdownMs);
  for (let goal = 1; goal <= 3; goal += 1) {
    room.pose(orange, SOCCER.cx + 8, SOCCER.cz + 8, 100);
    for (let step = 1; step <= 23; step += 1)
      room.pose(blue, SOCCER.cx - 8 + step * 0.3, SOCCER.cz, 50);
    let steps = 0;
    while (room.game.snapshotSoccer()?.status === "playing" && steps++ < 300)
      room.advance(50);
    const current = room.game.snapshotSoccer();
    if (goal < 3) {
      assert.equal(current?.status, "goal");
      assert.equal(current.scores.blue, goal);
      assert.equal(current.goalTeam, "blue");
      const ball = current.ball;
      for (let repeated = 0; repeated < 8; repeated += 1) room.game.tick();
      room.advance(500);
      assert.deepEqual(room.game.snapshotSoccer().ball, ball);
      assert.equal(room.game.snapshotSoccer().scores.blue, goal);
      assert.equal(room.game.canMove(blue.player.id), false);
      room.advance(SOCCER.goalPauseMs - 500);
      assert.equal(room.game.snapshotSoccer().status, "playing");
      assert.equal(room.game.snapshotSoccer().sequence, goal + 1);
      assert.deepEqual(room.game.snapshotSoccer().ball, soccerBall());
    } else assert.equal(current, null);
  }
  const finishes = room.events.filter(
    (event) => event.type === "soccer:finish",
  );
  assert.equal(finishes.length, 1);
  assert.equal(finishes[0].result.winnerTeam, "blue");
  assert.deepEqual(finishes[0].result.scores, { blue: 3, orange: 0 });
  assert.equal(finishes[0].result.reason, "goals");
  for (const [index, user] of [blue, orange].entries()) {
    assert.equal(user.player.x, homes[index].x);
    assert.equal(user.player.z, homes[index].z);
    assert.equal(room.game.profile(user.player.id).coins, 0);
  }
});
