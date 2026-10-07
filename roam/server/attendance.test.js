import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createGameEngine } from "./game.js";
import {
  ATTENDANCE_DAY_MS,
  getAttendanceReward,
} from "../src/attendanceConfig.js";
import {
  DUPLICATE_REFUND,
  ITEMS,
  STARTER_EQUIPPED,
} from "../src/gameConfig.js";

const START = Date.parse("2026-10-07T03:00:00Z");
const MYTHICS = ITEMS.filter(
  (item) => item.type === "body" && item.rarity === "mythic",
);
const EPIC_PLUS = ITEMS.filter(
  (item) =>
    item.type === "body" &&
    ["epic", "legendary", "mythic"].includes(item.rarity),
);

function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), "roam-attendance-"));
  let time = options.time ?? START;
  let roll = 0;
  const profiles = [];
  const engines = [];
  const database = (work) => {
    const db = new DatabaseSync(join(directory, "game.sqlite"));
    try {
      return work(db);
    } finally {
      db.close();
    }
  };
  if (options.prepare) database(options.prepare);
  const start = () => {
    const game = createGameEngine({
      directory,
      now: () => time,
      random: () => roll,
      updateProfile: (id, profile) => profiles.push({ id, profile }),
    });
    engines.push(game);
    return game;
  };
  const game = start();
  t.after(() => {
    for (const engine of engines) engine.shutdown();
    rmSync(directory, { recursive: true, force: true });
  });
  const attach = (engine = game, token, nickname = "출석 테스트") => {
    const player = { id: randomUUID(), nickname, x: 0, y: 0, z: 0, heading: 0 };
    return { player, ...engine.attach(player, token) };
  };
  const action = (
    player,
    name = "attendance:claim",
    requestId = randomUUID(),
    values = {},
    engine = game,
  ) =>
    engine.handle(player.id, {
      type: "game",
      action: name,
      requestId,
      ...values,
    });
  return {
    game,
    start,
    attach,
    action,
    database,
    profiles,
    setTime: (value) => {
      time = value;
    },
    advance: (value = ATTENDANCE_DAY_MS) => {
      time += value;
    },
    setRoll: (value) => {
      roll = value;
    },
  };
}

function legacyAccount(db, inventory = Object.values(STARTER_EQUIPPED)) {
  db.exec(`CREATE TABLE accounts (
    id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
    coins INTEGER NOT NULL CHECK(coins >= 0), inventory TEXT NOT NULL, equipped TEXT NOT NULL
  );`);
  const token = "a".repeat(43);
  db.prepare("INSERT INTO accounts VALUES (?, ?, ?, ?, ?)").run(
    "legacy-account",
    createHash("sha256").update(token).digest("hex"),
    321,
    JSON.stringify(inventory),
    JSON.stringify(STARTER_EQUIPPED),
  );
  return token;
}

test("the first two cycles grant one welcome mythic, repeat coins and epic-or-better vehicles", (t) => {
  const room = fixture(t);
  const { player } = room.attach();
  let coins = 0;
  for (let lifetimeDay = 1; lifetimeDay <= 14; lifetimeDay += 1) {
    const before = room.game.profile(player.id);
    assert.equal(before.attendance.available, true);
    assert.equal(before.attendance.claimedDays, lifetimeDay - 1);
    const expected = getAttendanceReward(lifetimeDay);
    assert.deepEqual(before.attendance.reward, expected);
    const result = room.action(player);
    assert.equal(result.ok, true);
    assert.equal(result.attendanceReward.day, expected.day);
    assert.equal(result.attendanceReward.cycle, expected.cycle);
    assert.equal(result.attendanceReward.kind, expected.kind);
    if (expected.kind === "vehicle") {
      assert.equal(result.item.type, "body");
      if (lifetimeDay === 1) assert.equal(result.item.rarity, "mythic");
      else
        assert.ok(["epic", "legendary", "mythic"].includes(result.item.rarity));
      assert.equal(result.duplicate, false);
      assert.ok(result.profile.inventory.includes(result.item.id));
    } else {
      coins += expected.coins;
      assert.equal(result.attendanceReward.coins, expected.coins);
    }
    assert.equal(result.profile.coins, coins);
    assert.equal(result.profile.attendance.claimedDays, lifetimeDay);
    assert.equal(result.profile.attendance.claimedToday, true);
    assert.equal(result.profile.attendance.available, false);
    assert.deepEqual(result.profile.attendance.reward, expected);
    assert.deepEqual(
      result.profile.attendance.lastClaim,
      result.attendanceReward,
    );
    assert.deepEqual(result.profile.equipped, STARTER_EQUIPPED);
    room.advance();
  }
  assert.equal(coins, 4100);
  assert.deepEqual(getAttendanceReward(15), {
    day: 1,
    cycle: 3,
    kind: "coins",
    coins: 100,
  });
  for (const value of [0, -1, 1.2, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => getAttendanceReward(value), RangeError);
});

test("Korean midnight unlocks the next claim, while missed dates preserve cumulative progress", (t) => {
  const midnight = Date.parse("2026-10-07T15:00:00Z");
  const room = fixture(t, { time: midnight - 1 });
  const { player } = room.attach();
  const first = room.action(player);
  assert.equal(first.profile.attendance.nextClaimAt, midnight);
  assert.equal(first.profile.attendance.serverNow, midnight - 1);
  assert.equal(room.action(player).code, "attendance_claimed");
  room.setTime(midnight);
  const second = room.action(player);
  assert.equal(second.ok, true);
  assert.equal(second.attendanceReward.coins, 200);
  assert.equal(
    second.profile.attendance.nextClaimAt,
    midnight + ATTENDANCE_DAY_MS,
  );
  room.advance(45 * ATTENDANCE_DAY_MS);
  const missed = room.action(player);
  assert.equal(missed.attendanceReward.day, 3);
  assert.equal(missed.attendanceReward.cycle, 1);
  assert.equal(missed.attendanceReward.coins, 300);
});

test("read-only status refreshes across midnight without consuming receipts or claiming automatically", (t) => {
  const room = fixture(t);
  const { player } = room.attach();
  const requestId = "status-reused";
  const before = room.action(player, "attendance:status", requestId);
  assert.equal(before.profile.attendance.available, true);
  assert.equal(before.profile.attendance.claimedDays, 0);
  assert.equal(room.profiles.length, 0);
  const claim = room.action(player, "attendance:claim", "actual-claim");
  assert.equal(claim.ok, true);
  assert.equal(
    room.action(player, "attendance:status", requestId).profile.attendance
      .available,
    false,
  );
  room.advance();
  const next = room.action(player, "attendance:status", requestId);
  assert.equal(next.ok, true);
  assert.equal(next.profile.attendance.available, true);
  assert.equal(next.profile.attendance.day, 2);
  assert.equal(next.profile.attendance.claimedToday, false);
  assert.equal(next.profile.attendance.claimedDays, 1);
  room.game.shutdown();
  room.database((db) => {
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM receipts").get().count,
      1,
    );
    assert.equal(
      db.prepare("SELECT claimed_days FROM attendance").get().claimed_days,
      1,
    );
    assert.equal(
      db
        .prepare("SELECT COUNT(*) AS count FROM receipts WHERE request_id = ?")
        .get(requestId).count,
      0,
    );
  });
});

test("same-day requests and rapid retries cannot duplicate a reward", (t) => {
  const room = fixture(t);
  const { player } = room.attach();
  const first = room.action(player, "attendance:claim", "first");
  for (let index = 0; index < 24; index += 1) {
    const replay = room.action(player, "attendance:claim", "first");
    assert.deepEqual(replay.attendanceReward, first.attendanceReward);
    assert.deepEqual(replay.item, first.item);
    const distinct = room.action(player);
    assert.equal(distinct.ok, false);
    assert.ok(["attendance_claimed", "rate_limited"].includes(distinct.code));
  }
  const profile = room.game.profile(player.id);
  assert.equal(profile.attendance.claimedDays, 1);
  assert.equal(
    profile.inventory.length,
    Object.keys(STARTER_EQUIPPED).length + 1,
  );
  assert.equal(profile.coins, 0);
});

test("resume identities retain attendance through renames and restarts; receipt replays return current profiles", (t) => {
  const room = fixture(t);
  const user = room.attach();
  const first = room.action(user.player, "attendance:claim", "durable-welcome");
  room.advance();
  assert.equal(room.action(user.player).profile.coins, 200);
  room.game.shutdown();
  const restarted = room.start();
  const resumed = room.attach(restarted, user.resumeToken, "새 닉네임");
  assert.equal(resumed.profile.attendance.claimedDays, 2);
  assert.equal(resumed.profile.attendance.available, false);
  const replay = room.action(
    resumed.player,
    "attendance:claim",
    "durable-welcome",
    {},
    restarted,
  );
  assert.deepEqual(replay.attendanceReward, first.attendanceReward);
  assert.equal(replay.profile.coins, 200);
  assert.equal(replay.profile.attendance.claimedDays, 2);
  const another = room.attach(restarted, undefined, "새 닉네임");
  assert.equal(another.profile.attendance.claimedDays, 0);
  assert.equal(another.profile.attendance.reward.minRarity, "mythic");
});

test("server clock rollback cannot reopen any rewarded date, even after restart", (t) => {
  const room = fixture(t);
  const user = room.attach();
  assert.equal(room.action(user.player).ok, true);
  room.advance();
  const second = room.action(user.player);
  room.setTime(START - 5 * ATTENDANCE_DAY_MS);
  assert.equal(room.action(user.player).code, "attendance_claimed");
  assert.equal(room.game.profile(user.player.id).attendance.available, false);
  assert.equal(
    room.game.profile(user.player.id).attendance.nextClaimAt,
    second.profile.attendance.nextClaimAt,
  );
  room.game.shutdown();
  const restarted = room.start();
  const resumed = room.attach(restarted, user.resumeToken);
  assert.equal(
    room.action(resumed.player, "attendance:claim", randomUUID(), {}, restarted)
      .code,
    "attendance_claimed",
  );
  room.setTime(START + 2 * ATTENDANCE_DAY_MS);
  const third = room.action(
    resumed.player,
    "attendance:claim",
    randomUUID(),
    {},
    restarted,
  );
  assert.equal(third.ok, true);
  assert.equal(third.attendanceReward.day, 3);
  assert.equal(third.profile.coins, 500);
});

test("vehicle draws select uniformly from eligible unowned vehicles without equipping them", (t) => {
  const room = fixture(t);
  assert.ok(MYTHICS.length > 0);
  for (let index = 0; index < MYTHICS.length; index += 1) {
    const { player } = room.attach();
    room.setRoll((index + 0.5) / MYTHICS.length);
    const result = room.action(player);
    assert.equal(result.item.id, MYTHICS[index].id);
    assert.equal(result.profile.equipped.body, STARTER_EQUIPPED.body);
  }
});

test("existing accounts migrate additively and prefer the only unowned welcome vehicle", (t) => {
  let token;
  const inventory = [
    ...Object.values(STARTER_EQUIPPED),
    ...MYTHICS.slice(0, -1).map((item) => item.id),
  ];
  const room = fixture(t, {
    prepare: (db) => {
      token = legacyAccount(db, inventory);
    },
  });
  const user = room.attach(room.game, token);
  assert.equal(user.profile.coins, 321);
  assert.deepEqual(user.profile.inventory, inventory);
  assert.equal(user.profile.attendance.claimedDays, 0);
  const result = room.action(user.player);
  assert.equal(result.item.id, MYTHICS.at(-1).id);
  assert.equal(result.duplicate, false);
  assert.equal(result.refund, 0);
  assert.equal(result.profile.coins, 321);
  assert.deepEqual(result.profile.equipped, STARTER_EQUIPPED);
});

test("owning all eligible vehicles awards exactly the existing duplicate refund", (t) => {
  let token;
  const inventory = [
    ...Object.values(STARTER_EQUIPPED),
    ...EPIC_PLUS.map((item) => item.id),
  ];
  const room = fixture(t, {
    prepare: (db) => {
      token = legacyAccount(db, inventory);
    },
  });
  const { player } = room.attach(room.game, token);
  for (let day = 1; day <= 7; day += 1) {
    const result = room.action(player);
    assert.equal(result.ok, true);
    if (day === 1 || day === 7) {
      assert.equal(result.duplicate, true);
      assert.equal(result.refund, DUPLICATE_REFUND);
      assert.equal(result.attendanceReward.refund, DUPLICATE_REFUND);
      assert.deepEqual(result.profile.inventory, inventory);
    }
    room.advance();
  }
  assert.equal(
    room.game.profile(player.id).coins,
    321 + 2000 + 2 * DUPLICATE_REFUND,
  );
});

test("a receipt failure rolls back the reward and attendance in the same transaction", (t) => {
  let token;
  const room = fixture(t, {
    prepare: (db) => {
      token = legacyAccount(db);
      db.exec(`CREATE TABLE receipts (
      account_id TEXT NOT NULL REFERENCES accounts(id), request_id TEXT NOT NULL,
      signature TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(account_id, request_id)
    );
    CREATE TRIGGER reject_attendance_receipt BEFORE INSERT ON receipts
    WHEN NEW.request_id = 'reject-receipt'
    BEGIN SELECT RAISE(ABORT, 'Simulated failed receipt'); END;`);
    },
  });
  const { player } = room.attach(room.game, token);
  const original = room.game.profile(player.id);
  const failure = room.action(player, "attendance:claim", "reject-receipt");
  assert.equal(failure.ok, false);
  assert.equal(failure.code, "game_unavailable");
  assert.deepEqual(room.game.profile(player.id), original);
  assert.equal(room.action(player).ok, true);
  room.advance();
  const beforeCoins = room.game.profile(player.id).coins;
  // The first failed attempt's in-memory receipt is immutable, so use a new
  // engine session to exercise the same DB fault with the second day's coins.
  room.game.detach(player.id);
  const resumed = room.attach(room.game, token);
  const coinFailure = room.action(
    resumed.player,
    "attendance:claim",
    "reject-receipt",
  );
  assert.equal(coinFailure.ok, false);
  assert.equal(room.game.profile(resumed.player.id).coins, beforeCoins);
  assert.equal(room.game.profile(resumed.player.id).attendance.claimedDays, 1);
  assert.equal(room.game.profile(resumed.player.id).attendance.available, true);
  assert.equal(room.action(resumed.player).profile.coins, beforeCoins + 200);
});

test("invalid randomness does not consume a day or silently issue an invalid vehicle", (t) => {
  const room = fixture(t);
  const { player } = room.attach();
  for (const value of [NaN, Infinity, -0.01, 1]) {
    room.setRoll(value);
    assert.equal(room.action(player).code, "game_unavailable");
    assert.equal(room.game.profile(player.id).attendance.claimedDays, 0);
    assert.deepEqual(
      room.game.profile(player.id).inventory,
      Object.values(STARTER_EQUIPPED),
    );
  }
  room.setRoll(0);
  assert.equal(room.action(player).ok, true);
});

test("unjoined clients and forged dates, rewards or items cannot grant attendance", (t) => {
  const room = fixture(t);
  const { player } = room.attach();
  assert.equal(room.action({ id: "not-joined" }).code, "not_joined");
  for (const values of [
    { day: 7 },
    { claimedAt: START + ATTENDANCE_DAY_MS },
    { date: "2099-01-01" },
    { coins: 999999 },
    { reward: { kind: "coins", coins: 999999 } },
    { itemId: MYTHICS[0].id },
    { cycle: 100 },
  ]) {
    assert.equal(
      room.action(player, "attendance:claim", randomUUID(), values).code,
      "invalid_game",
    );
    assert.equal(
      room.action(player, "attendance:status", randomUUID(), values).code,
      "invalid_game",
    );
  }
  assert.equal(room.game.profile(player.id).attendance.claimedDays, 0);
  assert.equal(room.game.profile(player.id).coins, 0);
  assert.equal(room.action(player).ok, true);
});
