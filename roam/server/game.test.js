import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { spawnSync } from "node:child_process";
import { WebSocket } from "ws";
import {
  createGameEngine,
  createLapTracker,
  advanceLap,
  drawItem,
  createDuelTracker,
  advanceDuel,
} from "./game.js";
import { createGameServer } from "./index.js";
import {
  trackPoint,
  STARTER_EQUIPPED,
  LAP_REWARD,
  CRATE_COST,
  DUPLICATE_REFUND,
  DUEL_TRACK,
  DUEL_LENGTH,
  duelStart,
} from "../src/gameConfig.js";
import {
  createDuelObstacles,
  DUEL_OBSTACLE_RULES,
} from "../src/duelObstacles.js";

function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), "roam-game-test-"));
  let time = 1_700_000_000_000;
  const events = [];
  const profiles = [];
  const lapUpdates = [];
  const engines = [];
  const start = () => {
    const game = createGameEngine({
      directory,
      now: () => time,
      random: () => 0,
      broadcast: (event) => events.push(event),
      updateProfile: (id, profile) => profiles.push({ id, profile }),
      updateLap: (id, state) => lapUpdates.push({ id, ...state }),
      ...options,
    });
    engines.push(game);
    return game;
  };
  const game = start();
  t.after(() => {
    for (const engine of engines) engine.shutdown();
    rmSync(directory, { recursive: true, force: true });
  });
  const advance = (milliseconds) => {
    time += milliseconds;
  };
  function attach(engine = game, token, nickname = "테스트 운전자") {
    const player = { id: randomUUID(), nickname, ...trackPoint(0), y: 0 };
    return { player, ...engine.attach(player, token) };
  }
  function pose(engine, player, progress, milliseconds = 100) {
    advance(milliseconds);
    Object.assign(player, trackPoint(progress), { y: 0 });
    engine.onMove(player.id, player);
  }
  function laps(engine, player, count = 1) {
    for (let lap = 0; lap < count; lap += 1) {
      for (let step = 0; step <= 100; step += 1)
        pose(engine, player, step / 100);
    }
  }
  function duel(engine, player) {
    const x = player.x;
    for (let step = 0; step <= 60; step += 1) {
      advance(100);
      Object.assign(player, {
        x,
        y: 0,
        z: DUEL_TRACK.startZ - (DUEL_LENGTH * step) / 60,
        heading: Math.PI,
      });
      engine.onMove(player.id, player);
    }
  }
  const action = (
    engine,
    player,
    action,
    values = {},
    requestId = randomUUID(),
  ) => engine.handle(player.id, { type: "game", action, requestId, ...values });
  return {
    game,
    start,
    attach,
    advance,
    laps,
    duel,
    pose,
    action,
    directory,
    events,
    profiles,
    lapUpdates,
  };
}

test("opaque identity persists earned coins and cosmetics while nicknames remain independent", (t) => {
  const room = fixture(t);
  const user = room.attach();
  assert.match(user.resumeToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(user.profile.coins, 0);
  assert.deepEqual(user.profile.equipped, STARTER_EQUIPPED);
  assert.throws(() => room.attach(room.game, user.resumeToken), {
    code: "identity_in_use",
  });
  assert.throws(() => room.attach(room.game, "forged"), {
    code: "invalid_token",
  });
  assert.throws(() => room.attach(room.game, "a".repeat(43)), {
    code: "invalid_token",
  });
  room.laps(room.game, user.player, 5);
  assert.equal(room.game.profile(user.player.id).coins, 5 * LAP_REWARD);
  const crate = room.action(room.game, user.player, "crate");
  assert.equal(crate.ok, true);
  assert.equal(crate.profile.coins, 0);
  assert.equal(
    room.action(room.game, user.player, "equip", { itemId: crate.item.id }).ok,
    true,
  );
  room.game.detach(user.player.id);
  room.game.shutdown();
  const restarted = room.start();
  const resumed = room.attach(restarted, user.resumeToken, "다른 닉네임");
  assert.equal(resumed.profile.equipped.body, crate.item.id);
  assert.deepEqual(resumed.player.cosmetics, resumed.profile.equipped);
  assert.equal(resumed.profile.coins, 0);
  assert.equal(
    room.attach(restarted, undefined, "테스트 운전자").profile.coins,
    0,
  );
});

test("rarity boundaries implement 75/20/4/1 and exclude starter items", () => {
  for (const [value, expected] of [
    [0, "common"],
    [0.7499999, "common"],
    [0.75, "rare"],
    [0.9499999, "rare"],
    [0.95, "epic"],
    [0.9899999, "epic"],
    [0.99, "legendary"],
    [0.9999999, "legendary"],
  ]) {
    let call = 0;
    const item = drawItem(() => (call++ ? 0.99999 : value));
    assert.equal(item.rarity, expected);
    assert.ok(!item.starter);
  }
  for (const value of [-0.1, 1, Infinity, NaN])
    assert.throws(() => drawItem(() => value), RangeError);
});

test("straight duel requires the whole course, valid timing, and in-bounds forward checkpoints", () => {
  const start = duelStart(0);
  const jumped = createDuelTracker(start, 0);
  assert.equal(
    advanceDuel(jumped, { ...start, z: DUEL_TRACK.finishZ }, 10000),
    false,
  );
  assert.equal(jumped.valid, false);
  const outside = createDuelTracker(start, 0);
  assert.equal(advanceDuel(outside, { ...start, x: -26, z: 17 }, 100), false);
  assert.equal(outside.valid, false);
  const rushed = createDuelTracker(start, 0);
  for (let step = 1; step <= 60; step += 1) {
    assert.equal(
      advanceDuel(rushed, { ...start, z: 18 - (42 * step) / 60 }, step * 10),
      false,
    );
  }
  const valid = createDuelTracker(start, 3000);
  assert.equal(advanceDuel(valid, { ...start, z: 17 }, 2000), false);
  let finishes = 0;
  for (let step = 0; step <= 60; step += 1) {
    if (
      advanceDuel(
        valid,
        { ...start, z: 18 - (42 * step) / 60 },
        3000 + step * 100,
      )
    )
      finishes += 1;
  }
  assert.equal(finishes, 1);
  assert.equal(valid.checkpoint, 9);
  assert.equal(valid.progress, 1);
});

test("lap rewards require ordered checkpoints, travel, and elapsed time; backtracking cannot farm starts", (t) => {
  const room = fixture(t);
  const { player } = room.attach();
  room.pose(room.game, player, 0);
  for (let index = 0; index < 1000; index += 1)
    room.pose(room.game, player, index % 2 ? 0.001 : 0);
  assert.equal(room.game.profile(player.id).coins, 0);
  room.game.resetLap(player.id);
  for (let step = 0; step <= 40; step += 1)
    room.pose(room.game, player, -step / 100);
  for (let step = 40; step >= 0; step -= 1)
    room.pose(room.game, player, -step / 100);
  assert.equal(room.game.profile(player.id).coins, 0);
  room.game.resetLap(player.id);
  for (let step = 0; step <= 100; step += 1)
    room.pose(room.game, player, step / 100, 5);
  assert.equal(room.game.profile(player.id).coins, 0);
  room.game.resetLap(player.id);
  for (let step = 0; step <= 50; step += 1)
    room.pose(room.game, player, step / 100);
  room.game.resetLap(player.id); // Explicit reset/teleport cancels the partial lap.
  for (let step = 51; step <= 100; step += 1)
    room.pose(room.game, player, step / 100);
  assert.equal(room.game.profile(player.id).coins, 0);
  room.laps(room.game, player);
  assert.equal(room.game.profile(player.id).coins, LAP_REWARD);
  assert.equal(
    room.action(room.game, player, "lap", { coins: 10000 }).ok,
    false,
  );
  assert.equal(room.game.profile(player.id).coins, LAP_REWARD);
});

test("lap tracker tolerates a small backward collision without advancing checkpoints twice", () => {
  const tracker = createLapTracker();
  let time = 0;
  let rewarded = 0;
  const move = (progress) => {
    time += 100;
    if (advanceLap(tracker, trackPoint(progress), time)) rewarded += 1;
  };
  for (let step = 0; step <= 50; step += 1) move(step / 100);
  move(0.49);
  move(0.5);
  for (let step = 51; step <= 100; step += 1) move(step / 100);
  assert.equal(rewarded, 1);
});

test("either lap direction earns once per full circuit from mid-road and survives a long stop", (t) => {
  const room = fixture(t);
  const origin = 0.371;
  for (const direction of [-1, 1]) {
    const { player } = room.attach();
    room.pose(room.game, player, origin);
    for (let step = 1; step <= 120; step += 1) {
      if (step === 61) {
        room.pose(room.game, player, origin + direction * 0.5, 30_000);
        assert.equal(room.game.lapProgress(player.id).progress, 0.5);
      }
      room.pose(room.game, player, origin + (direction * step) / 120);
      if (step < 120) assert.equal(room.game.profile(player.id).coins, 0);
    }
    assert.equal(room.game.profile(player.id).coins, LAP_REWARD);
    assert.deepEqual(room.game.lapProgress(player.id), {
      active: true,
      progress: 0,
    });
    for (let step = 1; step <= 120; step += 1)
      room.pose(room.game, player, origin + direction * (1 + step / 120));
    assert.equal(room.game.profile(player.id).coins, 2 * LAP_REWARD);
    assert.equal(
      room.events.filter(
        (event) => event.type === "lap" && event.playerId === player.id,
      ).length,
      2,
    );
  }
});

test("changing lap direction requires a whole circuit and repeated partial reversals earn nothing", (t) => {
  const room = fixture(t);
  const { player } = room.attach();
  room.pose(room.game, player, 0);
  for (let repeat = 0; repeat < 4; repeat += 1) {
    for (let step = 1; step <= 30; step += 1)
      room.pose(room.game, player, step / 100);
    for (let step = 29; step >= -30; step -= 1)
      room.pose(room.game, player, step / 100);
    for (let step = -29; step <= 0; step += 1)
      room.pose(room.game, player, step / 100);
  }
  assert.equal(room.game.profile(player.id).coins, 0);
  room.game.resetLap(player.id);
  for (let step = 0; step <= 20; step += 1)
    room.pose(room.game, player, step / 100);
  for (let step = 19; step > -100; step -= 1) {
    room.pose(room.game, player, step / 100);
    assert.equal(room.game.profile(player.id).coins, 0);
  }
  room.pose(room.game, player, -1);
  assert.equal(room.game.profile(player.id).coins, LAP_REWARD);
});

test("pausing does not make a large skipped section or leaving the road into a completed lap", () => {
  for (const invalidPose of [trackPoint(0.8), { x: 0, z: 34 }]) {
    const tracker = createLapTracker();
    let time = 0;
    let rewards = 0;
    const move = (pose, delay = 100) => {
      time += delay;
      if (advanceLap(tracker, pose, time)) rewards += 1;
    };
    for (let step = 0; step <= 40; step += 1) move(trackPoint(step / 100));
    move(invalidPose, 30_000);
    assert.equal(tracker.armed, false);
    for (let step = 41; step <= 100; step += 1) move(trackPoint(step / 100));
    assert.equal(rewards, 0);
  }
});

test("lap HUD updates report authoritative progress only when its percent or active state changes", (t) => {
  const room = fixture(t);
  const { player } = room.attach();
  assert.deepEqual(room.lapUpdates, [
    { id: player.id, active: false, progress: 0 },
  ]);
  room.pose(room.game, player, 0.3);
  assert.deepEqual(room.lapUpdates.at(-1), {
    id: player.id,
    active: true,
    progress: 0,
  });
  for (let i = 0; i < 20; i += 1) room.pose(room.game, player, 0.3);
  room.pose(room.game, player, 0.305);
  assert.equal(
    room.lapUpdates.length,
    2,
    "stationary and sub-percent moves do not spam the socket",
  );
  room.pose(room.game, player, 0.311);
  assert.deepEqual(room.lapUpdates.at(-1), {
    id: player.id,
    active: true,
    progress: 0.01,
  });
  room.pose(room.game, player, 0.31);
  assert.equal(room.lapUpdates.length, 3);
  room.game.resetLap(player.id);
  assert.deepEqual(room.lapUpdates.at(-1), {
    id: player.id,
    active: false,
    progress: 0,
  });
  room.pose(room.game, player, 0.31);
  room.game.onMove(player.id, { x: 0, z: 34 });
  assert.deepEqual(room.lapUpdates.at(-1), {
    id: player.id,
    active: false,
    progress: 0,
  });
});

test("crate debits, duplicate refunds, owned-only equipment, and durable request replay are atomic", (t) => {
  const room = fixture(t);
  const user = room.attach();
  room.laps(room.game, user.player, 10);
  const requestId = randomUUID();
  const first = room.action(room.game, user.player, "crate", {}, requestId);
  assert.equal(first.profile.coins, 200 - CRATE_COST);
  assert.equal(first.duplicate, false);
  assert.equal(first.refund, 0);
  const replay = room.action(room.game, user.player, "crate", {}, requestId);
  assert.equal(replay.item.id, first.item.id);
  assert.equal(replay.profile.coins, 100);
  const duplicate = room.action(room.game, user.player, "crate");
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.refund, DUPLICATE_REFUND);
  assert.equal(duplicate.profile.coins, 40);
  assert.equal(
    duplicate.profile.inventory.filter((id) => id === first.item.id).length,
    1,
  );
  assert.equal(
    room.action(room.game, user.player, "equip", { itemId: "body-gold" }).code,
    "item_not_owned",
  );
  assert.equal(
    room.action(
      room.game,
      user.player,
      "equip",
      { itemId: first.item.id },
      requestId,
    ).code,
    "request_conflict",
  );
  room.game.detach(user.player.id);
  room.game.shutdown();
  const resumedGame = room.start();
  const resumed = room.attach(resumedGame, user.resumeToken);
  const durableReplay = room.action(
    resumedGame,
    resumed.player,
    "crate",
    {},
    requestId,
  );
  assert.equal(durableReplay.item.id, first.item.id);
  assert.equal(durableReplay.profile.coins, 40);
});

test("race creation and joining reserve both stakes, lock the countdown, then pay exactly one winner", (t) => {
  const room = fixture(t);
  const host = room.attach();
  const guest = room.attach();
  room.laps(room.game, host.player, 5);
  room.laps(room.game, guest.player, 5);
  const hostOrigin = { x: 3, y: 0, z: 7, heading: 0.3 };
  const guestOrigin = { x: -4, y: 0, z: 8, heading: 1.2 };
  Object.assign(host.player, hostOrigin);
  Object.assign(guest.player, guestOrigin);
  const created = room.action(room.game, host.player, "race:create", {
    stake: 20,
  });
  assert.equal(created.profile.coins, 80);
  const joined = room.action(room.game, guest.player, "race:join", {
    raceId: created.race.id,
  });
  assert.equal(joined.profile.coins, 80);
  assert.equal(joined.race.status, "countdown");
  assert.equal(host.player.x, duelStart(0).x);
  assert.equal(guest.player.x, duelStart(1).x);
  assert.equal(host.player.z, DUEL_TRACK.startZ);
  assert.ok(!Object.hasOwn(joined.race, "returnPoses"));
  assert.ok(!Object.hasOwn(room.game.snapshotRaces()[0], "returnPoses"));
  assert.equal(room.game.isLocked(host.player.id), true);
  assert.equal(room.game.beforeTeleport(host.player.id), false);
  assert.equal(room.action(room.game, host.player, "race:cancel").ok, false);
  room.advance(3000);
  room.game.tick();
  assert.equal(room.game.snapshotRaces()[0].status, "racing");
  assert.equal(room.game.isLocked(host.player.id), false);
  const lapCount = room.events.filter((event) => event.type === "lap").length;
  room.duel(room.game, host.player);
  assert.equal(room.game.snapshotRaces().length, 0);
  assert.equal(room.game.profile(host.player.id).coins, 120);
  assert.equal(room.game.profile(guest.player.id).coins, 80);
  assert.equal(
    room.events.filter((event) => event.type === "lap").length,
    lapCount,
  );
  for (const [player, expected] of [
    [host.player, hostOrigin],
    [guest.player, guestOrigin],
  ]) {
    const { x, y, z, heading } = player;
    assert.deepEqual({ x, y, z, heading }, expected);
  }
  const finish = room.events.filter((event) => event.type === "race:finish");
  assert.equal(finish.length, 1);
  assert.deepEqual(finish[0].result, {
    raceId: created.race.id,
    hostId: host.player.id,
    guestId: guest.player.id,
    winnerId: host.player.id,
    winnerNickname: host.player.nickname,
    pot: 40,
    reason: "finished",
  });
  room.game.tick();
  assert.equal(
    room.game.profile(host.player.id).coins +
      room.game.profile(guest.player.id).coins,
    200,
  );
});

test("race cancellation, forfeits, and timeout refunds conserve reserved coins", (t) => {
  const room = fixture(t);
  const host = room.attach();
  const guest = room.attach();
  room.laps(room.game, host.player, 5);
  room.laps(room.game, guest.player, 5);
  for (const stake of [0, -1, 1.5, 10001, "20"])
    assert.equal(
      room.action(room.game, host.player, "race:create", { stake }).ok,
      false,
    );
  room.advance(1000);
  const waiting = room.action(room.game, host.player, "race:create", {
    stake: 20,
  });
  const cancelId = randomUUID();
  assert.equal(
    room.action(room.game, host.player, "race:cancel", {}, cancelId).profile
      .coins,
    100,
  );
  assert.equal(
    room.action(room.game, host.player, "race:cancel", {}, cancelId).profile
      .coins,
    100,
  );
  assert.equal(room.game.snapshotRaces().length, 0);
  const race = room.action(room.game, host.player, "race:create", {
    stake: 20,
  });
  room.action(room.game, guest.player, "race:join", { raceId: race.race.id });
  room.game.detach(guest.player.id);
  assert.equal(host.player.x, trackPoint(0).x);
  assert.equal(host.player.z, trackPoint(0).z);
  assert.equal(room.game.profile(host.player.id).coins, 120);
  const rejoined = room.attach(room.game, guest.resumeToken);
  assert.equal(rejoined.profile.coins, 80);
  room.advance(1000);
  const timeout = room.action(room.game, host.player, "race:create", {
    stake: 20,
  });
  room.action(room.game, rejoined.player, "race:join", {
    raceId: timeout.race.id,
  });
  room.advance(123001);
  room.game.tick();
  assert.equal(host.player.z, trackPoint(0).z);
  assert.equal(rejoined.player.z, trackPoint(0).z);
  assert.equal(room.game.profile(host.player.id).coins, 120);
  assert.equal(room.game.profile(rejoined.player.id).coins, 80);
  assert.equal(room.game.snapshotRaces().length, 0);
  assert.equal(room.events.at(-1).result.reason, "timeout");
  assert.ok(waiting.race.id);
});

test("duel obstacles belong to one race and validate participant, start, position, height, and cooldown across both lanes", (t) => {
  const room = fixture(t);
  const host = room.attach();
  const guest = room.attach();
  const spectator = room.attach();
  room.laps(room.game, host.player, 5);
  room.laps(room.game, guest.player, 5);
  const created = room.action(room.game, host.player, "race:create", {
    stake: 20,
  });
  const requestId = randomUUID();
  const joined = room.action(
    room.game,
    guest.player,
    "race:join",
    { raceId: created.race.id },
    requestId,
  );
  const { obstacles, obstacleSeed } = joined.race;
  assert.deepEqual(
    obstacles,
    createDuelObstacles(obstacleSeed, created.race.id),
  );
  assert.deepEqual(room.game.snapshotRaces()[0].obstacles, obstacles);
  assert.deepEqual(
    room.action(
      room.game,
      guest.player,
      "race:join",
      { raceId: created.race.id },
      requestId,
    ).race.obstacles,
    obstacles,
    "retrying join must not change an already agreed layout",
  );
  const first = obstacles.find((item) => item.lane === 0);
  const mirrored = obstacles.find(
    (item) => item.lane === 1 && item.z === first.z,
  );
  assert.equal(
    room.game.interact(host.player.id, first.id).code,
    "race_not_started",
  );
  Object.assign(spectator.player, { x: first.x, z: first.z, y: 0 });
  assert.equal(
    room.game.interact(spectator.player.id, first.id).code,
    "race_unavailable",
  );
  room.advance(3000);
  room.game.tick();
  assert.equal(
    room.game.interact(host.player.id, "duel-old-race-0-0").code,
    "invalid_interaction",
  );
  assert.equal(
    room.game.interact(host.player.id, first.id).code,
    "interaction_out_of_range",
  );
  Object.assign(host.player, { x: first.x, z: first.z, y: 3 });
  assert.equal(
    room.game.interact(host.player.id, first.id).code,
    "interaction_in_air",
  );
  host.player.y = 1.3; // A single 80ms old pose may still be just above a landing.
  const accepted = room.game.interact(host.player.id, first.id);
  assert.deepEqual(accepted.event, {
    type: "interaction",
    raceId: created.race.id,
    objectId: first.id,
    kind: first.kind,
    playerId: host.player.id,
  });
  assert.deepEqual(room.events.at(-1), accepted.event);
  assert.equal(
    room.game.interact(host.player.id, first.id).code,
    "rate_limited",
  );
  Object.assign(host.player, { x: mirrored.x, z: mirrored.z, y: 0 });
  assert.equal(
    room.game.interact(host.player.id, mirrored.id).ok,
    true,
    "changing lanes does not bypass the other lane's obstacles",
  );
  Object.assign(guest.player, { x: mirrored.x, z: mirrored.z, y: 0 });
  assert.equal(room.game.interact(guest.player.id, mirrored.id).ok, true);
  const next = obstacles.find(
    (item) => item.lane === 0 && item.id !== first.id,
  );
  Object.assign(host.player, { x: next.x, z: next.z, y: 0 });
  assert.equal(
    room.game.interact(host.player.id, next.id).ok,
    true,
    "a different obstacle has an independent cooldown",
  );
  room.advance(DUEL_OBSTACLE_RULES[first.kind].cooldownMs);
  Object.assign(host.player, { x: first.x, z: first.z, y: 0 });
  assert.equal(room.game.interact(host.player.id, first.id).ok, true);
  assert.equal(room.action(room.game, guest.player, "race:leave").ok, true);
  assert.equal(
    room.game.interact(host.player.id, first.id).code,
    "race_unavailable",
  );
  const second = room.action(room.game, host.player, "race:create", {
    stake: 20,
  });
  room.action(room.game, guest.player, "race:join", { raceId: second.race.id });
  room.advance(3000);
  room.game.tick();
  assert.equal(
    room.game.interact(host.player.id, first.id).code,
    "invalid_interaction",
    "old race packets cannot activate a new layout",
  );
  assert.equal(
    room.game.profile(host.player.id).coins +
      room.game.profile(guest.player.id).coins,
    160,
  );
});

test("one physical duel course admits only one active race without charging blocked guests", (t) => {
  const room = fixture(t);
  const [firstHost, firstGuest, nextHost, nextGuest] = Array.from(
    { length: 4 },
    () => room.attach(),
  );
  for (const { player } of [firstHost, firstGuest, nextHost, nextGuest])
    room.laps(room.game, player);
  const first = room.action(room.game, firstHost.player, "race:create", {
    stake: 20,
  });
  const next = room.action(room.game, nextHost.player, "race:create", {
    stake: 20,
  });
  assert.equal(first.ok, true);
  assert.equal(next.ok, true);
  assert.equal(
    room.game.snapshotRaces().filter((race) => race.status === "waiting")
      .length,
    2,
  );
  assert.equal(
    room.action(room.game, firstGuest.player, "race:join", {
      raceId: first.race.id,
    }).ok,
    true,
  );

  for (const status of ["countdown", "racing"]) {
    if (status === "racing") {
      room.advance(3000);
      room.game.tick();
    }
    assert.equal(
      room.game.snapshotRaces().find((race) => race.id === first.race.id)
        .status,
      status,
    );
    const refused = room.action(room.game, nextGuest.player, "race:join", {
      raceId: next.race.id,
    });
    assert.equal(refused.ok, false);
    assert.equal(refused.code, "course_busy");
    assert.equal(
      refused.message,
      "직선 코스에서 다른 대결이 진행 중이에요. 끝난 뒤 참가해 주세요.",
    );
    assert.equal(refused.profile.coins, 20);
    assert.equal(room.game.profile(nextHost.player.id).coins, 0); // Only its original host escrow exists.
    const waiting = room.game
      .snapshotRaces()
      .find((race) => race.id === next.race.id);
    assert.equal(waiting.status, "waiting");
    assert.equal(waiting.guestId, null);
    assert.equal(nextGuest.player.x, trackPoint(0).x);
  }

  // Settling the active race frees the physical lanes immediately. Retrying
  // with a new request can now debit the guest once and start the waiting race.
  assert.equal(
    room.action(room.game, firstGuest.player, "race:leave").ok,
    true,
  );
  assert.equal(room.game.profile(firstHost.player.id).coins, 40);
  const admitted = room.action(room.game, nextGuest.player, "race:join", {
    raceId: next.race.id,
  });
  assert.equal(admitted.ok, true);
  assert.equal(admitted.profile.coins, 0);
  assert.equal(admitted.race.status, "countdown");
  assert.equal(room.game.snapshotRaces().length, 1);
  assert.equal(room.game.snapshotRaces()[0].guestId, nextGuest.player.id);
});

test("startup refunds an unresolved persisted escrow once; graceful shutdown also refunds", (t) => {
  const room = fixture(t);
  room.game.shutdown();
  // A separate process exits without shutdown, leaving a real committed WAL
  // and unresolved escrow. No production process or directory is touched.
  const script = `
    import {createGameEngine} from ${JSON.stringify(new URL("./game.js", import.meta.url).href)};
    import {trackPoint} from ${JSON.stringify(new URL("../src/gameConfig.js", import.meta.url).href)};
    let time=1700000000000;
    const game=createGameEngine({directory:process.env.TEST_GAME_DIR,now:()=>time});
    const host={id:'host',nickname:'Host',...trackPoint(0)},guest={id:'guest',nickname:'Guest',...trackPoint(0)};
    const h=game.attach(host),g=game.attach(guest);
    for(const player of [host,guest]) for(let lap=0;lap<5;lap++) for(let i=0;i<=100;i++) {
      time+=100;Object.assign(player,trackPoint(i/100));game.onMove(player.id,player);
    }
    const race=game.handle(host.id,{type:'game',action:'race:create',requestId:'create',stake:20});
    game.handle(guest.id,{type:'game',action:'race:join',requestId:'join',raceId:race.race.id});
    process.stdout.write(JSON.stringify({host:h.resumeToken,guest:g.resumeToken}));
    process.exit(0);
  `;
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    {
      env: { ...process.env, TEST_GAME_DIR: room.directory },
      encoding: "utf8",
      windowsHide: true,
    },
  );
  assert.equal(child.status, 0, child.stderr);
  const tokens = JSON.parse(child.stdout);
  const recovered = room.start();
  const h = room.attach(recovered, tokens.host);
  const g = room.attach(recovered, tokens.guest);
  assert.equal(h.profile.coins, 100);
  assert.equal(g.profile.coins, 100);
  assert.throws(() => room.start(), /locked|busy/i);
  const nextRace = room.action(recovered, h.player, "race:create", {
    stake: 20,
  });
  room.action(recovered, g.player, "race:join", { raceId: nextRace.race.id });
  recovered.shutdown();
  const final = room.start();
  assert.equal(room.attach(final, tokens.host).profile.coins, 100);
  assert.equal(room.attach(final, tokens.guest).profile.coins, 100);
});

test("sprays use equipped ownership and authoritative pose, deduplicate, expire, and stay bounded", (t) => {
  const room = fixture(t);
  const { player } = room.attach();
  Object.assign(player, { x: 3, z: 7 });
  const id = randomUUID();
  assert.equal(room.action(room.game, player, "spray", {}, id).ok, true);
  room.action(room.game, player, "spray", {}, id);
  assert.equal(room.game.recentSprays().length, 1);
  assert.equal(room.action(room.game, player, "spray").code, "rate_limited");
  assert.equal(
    room.action(room.game, player, "spray", { itemId: "spray-crown", x: 999 })
      .ok,
    false,
  );
  assert.deepEqual(
    room.game
      .recentSprays()
      .map(({ playerId, itemId, x, z }) => ({ playerId, itemId, x, z })),
    [{ playerId: player.id, itemId: STARTER_EQUIPPED.spray, x: 3, z: 7 }],
  );
  for (let index = 0; index < 45; index += 1) {
    const other = room.attach();
    room.action(room.game, other.player, "spray");
  }
  assert.equal(room.game.recentSprays().length, 40);
  room.advance(30001);
  assert.deepEqual(room.game.recentSprays(), []);
});

test("WebSocket joins expose only public cosmetics, persist resume tokens, and accept track travel", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "roam-game-socket-"));
  const server = createGameServer({
    allowedOrigins: ["http://localhost:5173"],
    playersDirectory: join(directory, "players"),
    galleryDirectory: join(directory, "gallery"),
  });
  const sockets = [];
  t.after(async () => {
    for (const socket of sockets) socket.terminate();
    await new Promise((resolve) => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const connect = async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`, {
      origin: "http://localhost:5173",
    });
    sockets.push(socket);
    await once(socket, "open");
    return socket;
  };
  const wait = (socket, type) =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.off("message", receive);
        reject(new Error(`Missing ${type}`));
      }, 2000);
      const receive = (raw) => {
        const packet = JSON.parse(raw);
        if (packet.type === type) {
          clearTimeout(timeout);
          socket.off("message", receive);
          resolve(packet);
        }
      };
      socket.on("message", receive);
    });
  const first = await connect();
  const joining = wait(first, "welcome");
  first.send(JSON.stringify({ type: "join", nickname: "게임 테스트" }));
  const welcome = await joining;
  assert.equal(welcome.profile.coins, 0);
  assert.deepEqual(welcome.player.cosmetics, STARTER_EQUIPPED);
  assert.ok(!JSON.stringify(welcome.players).includes(welcome.resumeToken));
  const travelling = wait(first, "teleport");
  first.send(JSON.stringify({ type: "teleport", destination: "track" }));
  assert.equal((await travelling).player.z, trackPoint(0).z);
  const replying = wait(first, "game:result");
  first.send(
    JSON.stringify({ type: "game", action: "crate", requestId: "no-coins" }),
  );
  assert.equal((await replying).code, "insufficient_coins");
  const second = await connect();
  const refusing = wait(second, "error");
  second.send(
    JSON.stringify({
      type: "join",
      nickname: "동시 접속",
      token: welcome.resumeToken,
    }),
  );
  assert.equal((await refusing).code, "identity_in_use");
});

test("real WebSocket duel drives both lanes, pays only the pot, and restores participants without stale-move warnings", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "roam-straight-socket-"));
  let seedTime = 1_700_000_000_000;
  const seed = createGameEngine({ directory, now: () => seedTime });
  const tokens = [];
  for (let index = 0; index < 2; index += 1) {
    const player = {
      id: randomUUID(),
      nickname: `Seed ${index}`,
      ...trackPoint(0),
      y: 0,
    };
    tokens.push(seed.attach(player).resumeToken);
    for (let step = 0; step <= 100; step += 1) {
      seedTime += 100;
      Object.assign(player, trackPoint(step / 100));
      seed.onMove(player.id, player);
    }
  }
  seed.shutdown();
  const server = createGameServer({
    allowedOrigins: ["http://localhost:5173"],
    playersDirectory: directory,
    galleryDirectory: join(directory, "gallery"),
  });
  const peers = [];
  const errors = [];
  t.after(async () => {
    for (const peer of peers) peer.socket.terminate();
    await new Promise((resolve) => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const connect = async (index) => {
    const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`, {
      origin: "http://localhost:5173",
    });
    const peer = {
      socket,
      queue: [],
      waiters: [],
      player: null,
      profile: null,
    };
    peers.push(peer);
    peer.wait = (predicate) => {
      const index = peer.queue.findIndex(predicate);
      if (index >= 0) return Promise.resolve(peer.queue.splice(index, 1)[0]);
      const promise = new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, timer: null };
        waiter.timer = setTimeout(() => {
          peer.waiters = peer.waiters.filter(
            (candidate) => candidate !== waiter,
          );
          reject(new Error("Expected straight duel packet did not arrive"));
        }, 10000);
        peer.waiters.push(waiter);
      });
      promise.catch(() => {});
      return promise;
    };
    socket.on("message", (raw) => {
      const packet = JSON.parse(raw);
      if (packet.type === "error")
        errors.push({ code: packet.code, operation: packet.operation });
      if (packet.profile) peer.profile = packet.profile;
      if (packet.type === "teleport") peer.player = packet.player;
      if (packet.type === "state" && peer.player) {
        peer.player =
          packet.players.find((player) => player.id === peer.player.id) ||
          peer.player;
      }
      const index = peer.waiters.findIndex(({ predicate }) =>
        predicate(packet),
      );
      if (index >= 0) {
        const [waiter] = peer.waiters.splice(index, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(packet);
      } else if (packet.type !== "state") peer.queue.push(packet);
    });
    await once(socket, "open");
    const joining = peer.wait((packet) => packet.type === "welcome");
    socket.send(
      JSON.stringify({
        type: "join",
        nickname: `Straight ${index}`,
        token: tokens[index],
      }),
    );
    const welcome = await joining;
    peer.player = welcome.player;
    peer.origin = {
      x: welcome.player.x,
      y: welcome.player.y,
      z: welcome.player.z,
      heading: welcome.player.heading,
    };
    assert.equal(welcome.profile.coins, 20);
    return peer;
  };
  const [host, guest] = await Promise.all([connect(0), connect(1)]);
  const action = async (peer, action, values = {}) => {
    const requestId = randomUUID();
    const response = peer.wait(
      (packet) =>
        packet.type === "game:result" && packet.requestId === requestId,
    );
    peer.socket.send(
      JSON.stringify({ type: "game", action, requestId, ...values }),
    );
    const packet = await response;
    assert.equal(packet.ok, true);
    return packet;
  };
  const created = await action(host, "race:create", { stake: 20 });
  const joined = await action(guest, "race:join", { raceId: created.race.id });
  assert.equal(joined.race.status, "countdown");
  assert.deepEqual(
    joined.race.obstacles,
    createDuelObstacles(joined.race.obstacleSeed, created.race.id),
  );
  await Promise.all(
    peers.map((peer) =>
      peer.wait(
        (packet) =>
          packet.type === "teleport" && packet.player.z === DUEL_TRACK.startZ,
      ),
    ),
  );
  assert.equal(host.player.x, duelStart(0).x);
  assert.equal(guest.player.x, duelStart(1).x);
  // Countdown attempts are ignored, without moving or generating warnings.
  host.socket.send(
    JSON.stringify({ type: "move", ...duelStart(0), z: 15, y: 0 }),
  );
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(host.player.z, DUEL_TRACK.startZ);
  await host.wait(
    (packet) =>
      packet.type === "race:state" &&
      packet.races.some(
        (race) => race.id === created.race.id && race.status === "racing",
      ),
  );
  const finished = host.wait(
    (packet) =>
      packet.type === "race:finish" && packet.result.raceId === created.race.id,
  );
  const activated = new Set();
  let lastJumpStep = -100;
  for (let step = 0; step <= 60; step += 1) {
    if (step) await new Promise((resolve) => setTimeout(resolve, 80));
    const progress = step / 60;
    const z = DUEL_TRACK.startZ - DUEL_LENGTH * progress;
    const airStep = step - lastJumpStep;
    const y =
      airStep > 0 && airStep < 10
        ? Math.sin((airStep * Math.PI) / 10) * 3.2
        : 0;
    host.socket.send(
      JSON.stringify({
        type: "move",
        ...duelStart(0),
        z,
        y,
      }),
    );
    const obstacle = joined.race.obstacles.find(
      (item) =>
        item.lane === 0 &&
        !activated.has(item.id) &&
        Math.abs(item.z - z) < 1.4 &&
        y === 0,
    );
    if (obstacle) {
      host.socket.send(
        JSON.stringify({ type: "interaction", objectId: obstacle.id }),
      );
      const event = await guest.wait(
        (packet) =>
          packet.type === "interaction" && packet.objectId === obstacle.id,
      );
      assert.equal(event.raceId, created.race.id);
      assert.equal(event.kind, obstacle.kind);
      assert.equal(event.playerId, host.player.id);
      activated.add(obstacle.id);
      lastJumpStep = step;
    }
    // The slower rival also moves, proving both independent lanes are accepted.
    if (step < 60)
      guest.socket.send(
        JSON.stringify({
          type: "move",
          ...duelStart(1),
          z: DUEL_TRACK.startZ - DUEL_LENGTH * progress * 0.8,
          y: 0,
        }),
      );
  }
  assert.equal((await finished).result.winnerId, host.player.id);
  assert.equal(
    activated.size,
    joined.race.obstacles.length / 2,
    "all local lane obstacles broadcast without rejecting legitimate jumped movement",
  );
  // Model one rival movement packet already in flight when the server restored
  // the cars. It must not flash a correction or move the player back to the duel.
  guest.socket.send(
    JSON.stringify({ type: "move", ...duelStart(1), z: -15, y: 0 }),
  );
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(host.profile.coins, 40);
  assert.equal(guest.profile.coins, 0);
  for (const peer of peers) {
    const { x, y, z, heading } = peer.player;
    assert.deepEqual({ x, y, z, heading }, peer.origin);
    assert.ok(!peer.queue.some((packet) => packet.type === "lap"));
  }
  assert.deepEqual(errors, []);
});
