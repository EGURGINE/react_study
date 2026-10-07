import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createArenaController } from "./arena.js";
import { createAttendanceController } from "./attendance.js";
import {
  LAP_REWARD,
  CRATE_COST,
  STARTER_COINS,
  DUPLICATE_REFUND,
  RARITIES,
  ITEMS,
  ITEM_BY_ID,
  STARTER_EQUIPPED,
  TRACK,
  TRACK_LENGTH,
  projectTrack,
  DUEL_LENGTH,
  DUEL_TRACK,
  duelStart,
  projectDuel,
} from "../src/gameConfig.js";
import {
  createDuelObstacles,
  DUEL_OBSTACLE_RULES,
  DUEL_MOVEMENT_LIMITS,
} from "../src/duelObstacles.js";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{1,80}$/;
const TYPES = ["body", "trail", "spray"];
const MIN_LAP_MS = 2500;
const LAP_PROGRESS_EPSILON = 1e-9;
const MIN_DUEL_MS = Math.floor(
  ((DUEL_LENGTH - 2 * Math.PI * DUEL_TRACK.halfWidth) /
    DUEL_MOVEMENT_LIMITS.maxSpeed) *
    800,
);
const DUEL_CHECKPOINTS = 16;
const RACE_TIMEOUT_MS = 180_000;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const secureRandom = () => randomInt(0x100000000) / 0x100000000;
class GameError extends Error {}

function fail(message, code = "invalid_game") {
  const error = new GameError(message);
  error.code = code;
  throw error;
}

export function drawItem(random = secureRandom) {
  const roll = random();
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1)
    throw new RangeError("Random value must be in [0, 1)");
  const total = RARITIES.reduce((sum, rarity) => sum + rarity.weight, 0);
  let point = roll * total;
  const rarity =
    RARITIES.find((candidate) => (point -= candidate.weight) < 0) ??
    RARITIES.at(-1);
  const pool = ITEMS.filter(
    (item) => item.rarity === rarity.id && !item.starter,
  );
  const pick = random();
  if (!Number.isFinite(pick) || pick < 0 || pick >= 1)
    throw new RangeError("Random value must be in [0, 1)");
  return pool[Math.floor(pick * pool.length)];
}

export function createLapTracker() {
  return {
    armed: false,
    last: null,
    startedAt: 0,
    lastAt: 0,
    direction: 0,
    pending: 0,
    unwrapped: 0,
    checkpoint: 1,
    distance: 0,
  };
}

/** Only accepted server poses reach this tracker. Teleports explicitly reset it. */
export function advanceLap(tracker, pose, now) {
  const projected = projectTrack(pose.x, pose.z);
  const reset = () => Object.assign(tracker, createLapTracker());
  if (projected.distance > TRACK.halfWidth + 0.001) {
    reset();
    return false;
  }
  if (!tracker.armed) {
    Object.assign(tracker, {
      armed: true,
      last: { ...pose, progress: projected.progress },
      startedAt: now,
      lastAt: now,
      unwrapped: 0,
      checkpoint: 1,
      distance: 0,
    });
    return false;
  }
  let delta = projected.progress - tracker.last.progress;
  if (delta < -0.5) delta += 1;
  if (delta > 0.5) delta -= 1;
  const distance = Math.hypot(pose.x - tracker.last.x, pose.z - tracker.last.z);
  if (
    delta < -0.11 ||
    delta > 0.11 ||
    distance > 6.01 ||
    now < tracker.lastAt
  ) {
    reset();
    return false;
  }
  // Checkpoints are relative to the first accepted position. Select a direction
  // from actual travel, then subtract backtracking rather than counting its
  // absolute distance as progress. A full circuit in either direction counts.
  if (!tracker.direction) {
    tracker.pending += delta;
    if (Math.abs(tracker.pending) >= 0.001) {
      tracker.direction = Math.sign(tracker.pending);
      tracker.unwrapped = Math.abs(tracker.pending);
    }
  } else {
    tracker.unwrapped += delta * tracker.direction;
    // Passing the origin backwards allows a deliberate direction change. The
    // new direction must cross all its own checkpoints, including a full turn.
    if (tracker.unwrapped < -0.02) {
      tracker.direction *= -1;
      tracker.unwrapped *= -1;
      tracker.checkpoint = 1;
    }
  }
  tracker.distance += distance;
  tracker.last = { ...pose, progress: projected.progress };
  tracker.lastAt = now;
  while (
    tracker.checkpoint <= 8 &&
    tracker.unwrapped + LAP_PROGRESS_EPSILON >= tracker.checkpoint / 8
  )
    tracker.checkpoint += 1;
  if (tracker.checkpoint <= 8 || tracker.unwrapped + LAP_PROGRESS_EPSILON < 1)
    return false;
  const valid =
    now - tracker.startedAt >= MIN_LAP_MS &&
    tracker.distance >=
      (4 * TRACK.halfStraight +
        2 * Math.PI * (TRACK.radius - TRACK.halfWidth)) *
        0.95;
  reset();
  if (valid) advanceLap(tracker, pose, now);
  return valid;
}

export function createDuelTracker(pose, startsAt) {
  const projected = projectDuel(pose.x, pose.z);
  return {
    valid:
      projected.inside &&
      Math.min(projected.progress, 1 - projected.progress) < 0.01,
    finished: false,
    last: { ...pose, progress: projected.progress },
    lastAt: startsAt,
    startedAt: startsAt,
    progress: 0,
    unwrapped: 0,
    checkpoint: 1,
    distance: 0,
  };
}

/** One ordered forward circuit; collisions subtract progress without erasing it. */
export function advanceDuel(tracker, pose, now) {
  if (!tracker?.valid || tracker.finished || now < tracker.startedAt)
    return false;
  const projected = projectDuel(pose.x, pose.z);
  const elapsed = Math.max(0, (now - tracker.lastAt) / 1000);
  const distance = Math.hypot(pose.x - tracker.last.x, pose.z - tracker.last.z);
  let delta = projected.progress - tracker.last.progress;
  if (delta < -0.5) delta += 1;
  if (delta > 0.5) delta -= 1;
  // Match the server's generous catch-up allowance while still rejecting a
  // direct start-to-finish jump, even after a long pause.
  if (
    !projected.inside ||
    now < tracker.lastAt ||
    Math.abs(delta) > 0.2 ||
    distance > Math.min(30, 6 + elapsed * DUEL_MOVEMENT_LIMITS.maxSpeed) + 0.001
  ) {
    tracker.valid = false;
    return false;
  }
  // Endpoints on the same loop are insufficient: a chord through its empty
  // middle must not advance checkpoints, even in direct engine integrations.
  const steps = Math.ceil(distance / 0.5);
  for (let step = 1; step < steps; step += 1) {
    if (
      !projectDuel(
        tracker.last.x + ((pose.x - tracker.last.x) * step) / steps,
        tracker.last.z + ((pose.z - tracker.last.z) * step) / steps,
      ).inside
    ) {
      tracker.valid = false;
      return false;
    }
  }
  tracker.distance += distance;
  tracker.unwrapped += delta;
  tracker.progress = Math.max(0, Math.min(1, tracker.unwrapped));
  tracker.last = { ...pose, progress: projected.progress };
  tracker.lastAt = now;
  while (
    tracker.checkpoint <= DUEL_CHECKPOINTS &&
    tracker.unwrapped + LAP_PROGRESS_EPSILON >=
      tracker.checkpoint / DUEL_CHECKPOINTS
  )
    tracker.checkpoint += 1;
  if (
    tracker.checkpoint <= DUEL_CHECKPOINTS ||
    tracker.unwrapped + LAP_PROGRESS_EPSILON < 1
  )
    return false;
  const valid =
    tracker.distance >=
      (DUEL_LENGTH - 2 * Math.PI * DUEL_TRACK.halfWidth) * 0.95 &&
    now - tracker.startedAt >= MIN_DUEL_MS;
  tracker.finished = valid;
  if (!valid) tracker.valid = false;
  return valid;
}

/** One server process owns this database. SQLite commits all coin/escrow changes together. */
export function createGameEngine({
  directory,
  broadcast = () => {},
  updateProfile = () => {},
  updateLap = () => {},
  teleport = () => {},
  now = Date.now,
  random = secureRandom,
} = {}) {
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(join(directory, "game.sqlite"));
  let attendance;
  try {
    db.exec(`PRAGMA locking_mode = EXCLUSIVE; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 1000;
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
      coins INTEGER NOT NULL CHECK (coins >= 0), inventory TEXT NOT NULL, equipped TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS receipts (
      account_id TEXT NOT NULL REFERENCES accounts(id), request_id TEXT NOT NULL,
      signature TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY (account_id, request_id)
    );
    CREATE TABLE IF NOT EXISTS escrows (
      id TEXT PRIMARY KEY, host_account TEXT NOT NULL REFERENCES accounts(id),
      guest_account TEXT REFERENCES accounts(id), stake INTEGER NOT NULL CHECK (stake > 0)
    );`);
    attendance = createAttendanceController({ db, now, random, fail });
  } catch (error) {
    db.close();
    throw error;
  }
  let closed = false;
  const peers = new Map();
  const activeAccounts = new Map();
  const races = new Map();
  const sprays = [];
  let lastRaceBroadcastAt = -Infinity;
  const account = db.prepare("SELECT * FROM accounts WHERE id = ?");
  const balance = db.prepare(
    "UPDATE accounts SET coins = coins + ? WHERE id = ?",
  );
  const transaction = (work) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  const publicProfile = (row) => ({
    coins: row.coins,
    inventory: JSON.parse(row.inventory),
    equipped: JSON.parse(row.equipped),
    attendance: attendance.status(row.id),
  });
  const profile = (playerId) => {
    const peer = peers.get(playerId);
    return peer ? publicProfile(account.get(peer.accountId)) : null;
  };
  const refresh = (playerId) => {
    const peer = peers.get(playerId);
    if (!peer) return;
    const current = profile(playerId);
    peer.player.cosmetics = { ...current.equipped };
    updateProfile(playerId, current);
  };
  const snapshotRaces = () =>
    [...races.values()].map(
      ({ hostAccount, guestAccount, returnPoses, ...race }) => ({
        ...race,
        hostProgress: Math.max(
          0,
          Math.min(1, peers.get(race.hostId)?.duel?.progress || 0),
        ),
        guestProgress: Math.max(
          0,
          Math.min(1, peers.get(race.guestId)?.duel?.progress || 0),
        ),
      }),
    );
  const broadcastRaces = () =>
    broadcast({ type: "race:state", races: snapshotRaces() });
  const raceFor = (playerId) =>
    [...races.values()].find(
      (race) => race.hostId === playerId || race.guestId === playerId,
    );
  const lapProgress = (playerId) => {
    const tracker = peers.get(playerId)?.lap;
    return {
      active: Boolean(tracker?.armed),
      progress: tracker?.armed
        ? Math.min(
            0.99,
            Math.max(
              0,
              Math.floor((tracker.unwrapped + LAP_PROGRESS_EPSILON) * 100) /
                100,
            ),
          )
        : 0,
    };
  };
  const reportLap = (playerId) => {
    const peer = peers.get(playerId);
    if (!peer) return;
    const current = lapProgress(playerId);
    if (
      peer.lapState?.active === current.active &&
      peer.lapState?.progress === current.progress
    )
      return;
    peer.lapState = current;
    updateLap(playerId, { ...current });
  };
  const resetLap = (playerId) => {
    const peer = peers.get(playerId);
    if (peer) {
      peer.lap = createLapTracker();
      reportLap(playerId);
    }
  };
  const returnParticipants = (race) => {
    for (const id of [race.hostId, race.guestId]) {
      const peer = peers.get(id);
      if (!peer) continue;
      peer.duel = null;
      peer.duelHits.clear();
      resetLap(id);
      const pose = race.returnPoses?.[id];
      if (pose) {
        Object.assign(peer.player, pose);
        teleport(id, { ...pose });
      }
    }
  };

  // An unresolved stake is not a loss. Recovery happens in one durable commit,
  // so repeated restarts cannot refund the same escrow twice.
  try {
    transaction(() => {
      for (const escrow of db.prepare("SELECT * FROM escrows").all()) {
        balance.run(escrow.stake, escrow.host_account);
        if (escrow.guest_account)
          balance.run(escrow.stake, escrow.guest_account);
      }
      db.exec("DELETE FROM escrows");
    });
  } catch (error) {
    db.close();
    throw error;
  }

  let arena;
  try {
    arena = createArenaController({
      db,
      peers,
      balance,
      transaction,
      profile,
      refresh,
      resetLap,
      teleport,
      broadcast,
      now,
      random,
      fail,
      hasRace: (id) => Boolean(raceFor(id)),
    });
  } catch (error) {
    db.close();
    throw error;
  }

  function attach(player, token) {
    if (closed) fail("서버가 종료 중이에요.", "game_unavailable");
    let resumeToken = token;
    let row;
    if (token !== undefined && token !== null) {
      if (typeof token !== "string" || !TOKEN.test(token))
        fail("저장된 접속 키를 확인해 주세요.", "invalid_token");
      row = db
        .prepare("SELECT * FROM accounts WHERE token_hash = ?")
        .get(hash(token));
      if (!row) fail("저장된 접속 키를 찾을 수 없어요.", "invalid_token");
      if (activeAccounts.has(row.id))
        fail("같은 브라우저 계정이 이미 접속 중이에요.", "identity_in_use");
    } else {
      resumeToken = randomBytes(32).toString("base64url");
      const id = randomUUID();
      db.prepare(
        "INSERT INTO accounts (id, token_hash, coins, inventory, equipped) VALUES (?, ?, ?, ?, ?)",
      ).run(
        id,
        hash(resumeToken),
        STARTER_COINS,
        JSON.stringify(Object.values(STARTER_EQUIPPED)),
        JSON.stringify(STARTER_EQUIPPED),
      );
      row = account.get(id);
    }
    peers.set(player.id, {
      player,
      accountId: row.id,
      lap: createLapTracker(),
      duel: null,
      duelHits: new Map(),
      lastSprayAt: -Infinity,
      lastActionAt: -Infinity,
      windowAt: now(),
      windowCount: 0,
      receipts: new Map(),
    });
    activeAccounts.set(row.id, player.id);
    const current = publicProfile(row);
    player.cosmetics = { ...current.equipped };
    reportLap(player.id);
    return { profile: current, resumeToken };
  }

  function settle(race, winnerId, reason) {
    const escrow = db
      .prepare("SELECT * FROM escrows WHERE id = ?")
      .get(race.id);
    if (!escrow) {
      races.delete(race.id);
      returnParticipants(race);
      return;
    }
    const pot = escrow.stake * (escrow.guest_account ? 2 : 1);
    transaction(() => {
      if (winnerId && escrow.guest_account) {
        balance.run(
          pot,
          winnerId === race.hostId ? escrow.host_account : escrow.guest_account,
        );
      } else {
        balance.run(escrow.stake, escrow.host_account);
        if (escrow.guest_account)
          balance.run(escrow.stake, escrow.guest_account);
      }
      db.prepare("DELETE FROM escrows WHERE id = ?").run(race.id);
    });
    races.delete(race.id);
    returnParticipants(race);
    refresh(race.hostId);
    refresh(race.guestId);
    broadcastRaces();
    broadcast({
      type: "race:finish",
      result: {
        raceId: race.id,
        hostId: race.hostId,
        guestId: race.guestId,
        winnerId: winnerId || null,
        winnerNickname:
          winnerId === race.hostId
            ? race.hostNickname
            : winnerId === race.guestId
              ? race.guestNickname
              : null,
        pot: winnerId ? pot : 0,
        reason,
      },
    });
  }

  function detach(playerId) {
    const peer = peers.get(playerId);
    if (!peer) return;
    const race = raceFor(playerId);
    try {
      arena.detach(playerId);
      if (race)
        settle(
          race,
          race.guestId
            ? race.hostId === playerId
              ? race.guestId
              : race.hostId
            : null,
          race.guestId ? "forfeit" : "cancelled",
        );
    } finally {
      peers.delete(playerId);
      activeAccounts.delete(peer.accountId);
    }
  }

  function tick(includeArena = true) {
    if (closed) return;
    const time = now();
    if (includeArena) arena.tick();
    for (const race of [...races.values()]) {
      if (time >= race.expiresAt) {
        settle(race, null, "timeout");
        continue;
      }
      if (race.status === "countdown" && time >= race.startsAt) {
        race.status = "racing";
        broadcastRaces();
      }
    }
    while (sprays.length && time - Date.parse(sprays[0].createdAt) >= 30_000)
      sprays.shift();
    if (
      [...races.values()].some((race) => race.status === "racing") &&
      time - lastRaceBroadcastAt >= 250
    ) {
      lastRaceBroadcastAt = time;
      broadcastRaces();
    }
  }

  function onMove(playerId, pose) {
    const peer = peers.get(playerId);
    if (!peer || closed) return;
    tick(false);
    if (arena.observe(playerId, pose)) return;
    const race = raceFor(playerId);
    if (race?.status === "countdown") return;
    if (race?.status === "racing") {
      if (advanceDuel(peer.duel, pose, now()))
        settle(race, playerId, "finished");
      return;
    }
    if (!advanceLap(peer.lap, pose, now())) {
      reportLap(playerId);
      return;
    }
    transaction(() => {
      balance.run(LAP_REWARD, peer.accountId);
    });
    refresh(playerId);
    broadcast({
      type: "lap",
      playerId,
      nickname: peer.player.nickname,
      reward: LAP_REWARD,
      coins: LAP_REWARD,
    });
    reportLap(playerId);
  }

  function interact(playerId, objectId) {
    try {
      if (typeof objectId !== "string" || !objectId.startsWith("duel-"))
        fail("이 대결의 장애물을 선택해 주세요.", "invalid_interaction");
      tick(false);
      const peer = peers.get(playerId);
      const race = raceFor(playerId);
      if (!peer || !race)
        fail(
          "참가 중인 대결에서만 장애물을 사용할 수 있어요.",
          "race_unavailable",
        );
      const obstacle = race.obstacles?.find((item) => item.id === objectId);
      if (!obstacle)
        fail("이 대결의 장애물을 선택해 주세요.", "invalid_interaction");
      const time = now();
      if (race.status !== "racing" || time < race.startsAt)
        fail(
          "출발 신호가 나온 뒤에 장애물을 사용할 수 있어요.",
          "race_not_started",
        );
      const rule = DUEL_OBSTACLE_RULES[obstacle.kind];
      if (
        !projectDuel(peer.player.x, peer.player.z).inside ||
        Math.hypot(peer.player.x - obstacle.x, peer.player.z - obstacle.z) >
          obstacle.r + DUEL_MOVEMENT_LIMITS.proximityAllowance
      )
        fail("장애물에 조금 더 가까이 가 주세요.", "interaction_out_of_range");
      if (
        (peer.player.y || 0) >
        rule.maxTriggerHeight + DUEL_MOVEMENT_LIMITS.triggerHeightAllowance
      )
        fail("공중에서는 장애물을 다시 밟을 수 없어요.", "interaction_in_air");
      if (time - (peer.duelHits.get(objectId) ?? -Infinity) < rule.cooldownMs)
        fail("이 장애물은 잠시 뒤 다시 사용할 수 있어요.", "rate_limited");
      peer.duelHits.set(objectId, time);
      const event = {
        type: "interaction",
        raceId: race.id,
        objectId,
        kind: obstacle.kind,
        playerId,
      };
      broadcast(event);
      return { ok: true, event };
    } catch (error) {
      return {
        ok: false,
        code: error instanceof GameError ? error.code : "game_unavailable",
        message:
          error instanceof GameError
            ? error.message
            : "장애물 정보를 확인하지 못했어요.",
      };
    }
  }

  function handle(playerId, data) {
    const requestId =
      typeof data.requestId === "string" ? data.requestId : null;
    const base = { type: "game:result", requestId };
    const peer = peers.get(playerId);
    if (!peer || closed)
      return {
        ...base,
        ok: false,
        code: "not_joined",
        message: "먼저 아지트에 입장해 주세요.",
      };
    if (!REQUEST_ID.test(requestId || ""))
      return {
        ...base,
        ok: false,
        code: "invalid_request",
        message: "요청 번호를 확인해 주세요.",
      };
    const fields = {
      crate: [],
      equip: ["itemId"],
      "race:create": ["stake"],
      "race:join": ["raceId"],
      "race:cancel": [],
      "race:leave": [],
      "arena:create": [],
      "arena:join": ["arenaId"],
      "arena:start": ["arenaId"],
      "arena:leave": ["arenaId"],
      "attendance:claim": [],
      "attendance:status": [],
      spray: [],
    };
    const allowed = Object.hasOwn(fields, data.action)
      ? fields[data.action]
      : null;
    if (
      !allowed ||
      Object.keys(data).some(
        (key) => !["type", "action", "requestId", ...allowed].includes(key),
      )
    ) {
      return {
        ...base,
        ok: false,
        code: "invalid_game",
        message: "지원하지 않는 게임 요청이에요.",
      };
    }
    const signature = hash(
      JSON.stringify([data.action, ...allowed.map((field) => data[field])]),
    );
    const prior =
      data.action !== "attendance:status" &&
      (peer.receipts.get(requestId) ||
        db
          .prepare(
            "SELECT * FROM receipts WHERE account_id = ? AND request_id = ?",
          )
          .get(peer.accountId, requestId));
    if (prior) {
      if (prior.signature !== signature)
        return {
          ...base,
          ok: false,
          code: "request_conflict",
          message: "이미 사용한 요청 번호예요.",
        };
      return { ...JSON.parse(prior.result), profile: profile(playerId) };
    }
    const time = now();
    if (time - peer.windowAt >= 1000) {
      peer.windowAt = time;
      peer.windowCount = 0;
    }
    if (++peer.windowCount > 8)
      return {
        ...base,
        ok: false,
        code: "rate_limited",
        message: "잠시 후 다시 시도해 주세요.",
      };
    // Refreshes are read-only, including when a tab crosses Korean midnight.
    if (data.action === "attendance:status")
      return { ...base, ok: true, profile: profile(playerId) };
    const remember = (response) => {
      peer.receipts.set(requestId, {
        signature,
        result: JSON.stringify(response),
      });
      if (peer.receipts.size > 128)
        peer.receipts.delete(peer.receipts.keys().next().value);
    };
    try {
      tick(false);
      let effect = () => {};
      const result = transaction(() => {
        const current = profile(playerId);
        let details = {};
        if (data.action === "attendance:claim") {
          details = attendance.claim(peer.accountId, time);
        } else if (data.action.startsWith("arena:")) {
          const planned = arena.plan(playerId, data, time);
          details = planned.details;
          effect = planned.effect;
        } else if (data.action === "crate") {
          if (current.coins < CRATE_COST)
            fail("상자를 열려면 코인 100개가 필요해요.", "insufficient_coins");
          const item = drawItem(random);
          const duplicate = current.inventory.includes(item.id);
          if (!duplicate) current.inventory.push(item.id);
          const refund = duplicate ? DUPLICATE_REFUND : 0;
          db.prepare(
            "UPDATE accounts SET coins = coins - ? + ?, inventory = ? WHERE id = ?",
          ).run(
            CRATE_COST,
            refund,
            JSON.stringify(current.inventory),
            peer.accountId,
          );
          details = { item, duplicate, refund };
        } else if (data.action === "equip") {
          const item = ITEM_BY_ID.get(data.itemId);
          if (
            !item ||
            !TYPES.includes(item.type) ||
            !current.inventory.includes(item.id)
          )
            fail("보유한 아이템만 장착할 수 있어요.", "item_not_owned");
          if (
            item.type === "body" &&
            item.id !== current.equipped.body &&
            (raceFor(playerId) || arena.has(playerId))
          )
            fail(
              "대결을 기다리거나 달리는 동안에는 차체를 바꿀 수 없어요. 대결이 끝난 뒤 변경해 주세요.",
              "race_body_locked",
            );
          current.equipped[item.type] = item.id;
          db.prepare("UPDATE accounts SET equipped = ? WHERE id = ?").run(
            JSON.stringify(current.equipped),
            peer.accountId,
          );
        } else if (data.action === "race:create") {
          if (
            !Number.isSafeInteger(data.stake) ||
            data.stake < 1 ||
            data.stake > 10_000
          )
            fail("배팅은 코인 1~10,000개로 정해 주세요.", "invalid_stake");
          if (raceFor(playerId) || arena.has(playerId))
            fail("이미 참가 중인 대결이 있어요.", "already_racing");
          if (current.coins < data.stake)
            fail("배팅할 코인이 부족해요.", "insufficient_coins");
          const race = {
            id: randomUUID(),
            hostId: playerId,
            hostNickname: peer.player.nickname,
            guestId: null,
            guestNickname: null,
            stake: data.stake,
            status: "waiting",
            startsAt: null,
            expiresAt: time + RACE_TIMEOUT_MS,
            hostAccount: peer.accountId,
            guestAccount: null,
          };
          balance.run(-data.stake, peer.accountId);
          db.prepare(
            "INSERT INTO escrows (id, host_account, stake) VALUES (?, ?, ?)",
          ).run(race.id, peer.accountId, data.stake);
          const { hostAccount, guestAccount, ...visible } = race;
          details.race = visible;
          effect = () => {
            races.set(race.id, race);
            broadcastRaces();
          };
        } else if (data.action === "race:join") {
          const race = races.get(data.raceId);
          if (!race || race.status !== "waiting" || race.hostId === playerId)
            fail("참가할 수 없는 대결이에요.", "race_unavailable");
          if (raceFor(playerId) || arena.has(playerId))
            fail("이미 참가 중인 대결이 있어요.", "already_racing");
          if (
            [...races.values()].some(
              (other) =>
                other.id !== race.id &&
                ["countdown", "racing"].includes(other.status),
            )
          ) {
            fail(
              "외곽 코스에서 다른 대결이 진행 중이에요. 끝난 뒤 참가해 주세요.",
              "course_busy",
            );
          }
          if (current.coins < race.stake)
            fail("배팅할 코인이 부족해요.", "insufficient_coins");
          const joined = {
            ...race,
            guestId: playerId,
            guestNickname: peer.player.nickname,
            guestAccount: peer.accountId,
            status: "countdown",
            startsAt: time + 3000,
            expiresAt: time + 3000 + RACE_TIMEOUT_MS,
            obstacleSeed: randomInt(0x100000000),
            returnPoses: Object.fromEntries(
              [race.hostId, playerId].map((id) => {
                const { x, y = 0, z, heading } = peers.get(id).player;
                return [id, { x, y, z, heading }];
              }),
            ),
          };
          joined.obstacles = createDuelObstacles(joined.obstacleSeed, race.id);
          balance.run(-race.stake, peer.accountId);
          db.prepare("UPDATE escrows SET guest_account = ? WHERE id = ?").run(
            peer.accountId,
            race.id,
          );
          const { hostAccount, guestAccount, returnPoses, ...visible } = joined;
          details.race = visible;
          effect = () => {
            races.set(race.id, joined);
            for (const [index, id] of [race.hostId, playerId].entries()) {
              resetLap(id);
              peers.get(id).duelHits.clear();
              const point = { ...duelStart(index), y: 0 };
              peers.get(id).duel = createDuelTracker(point, joined.startsAt);
              Object.assign(peers.get(id).player, point);
              teleport(id, point);
            }
            broadcastRaces();
          };
        } else if (
          data.action === "race:cancel" ||
          data.action === "race:leave"
        ) {
          const race = raceFor(playerId);
          if (!race) fail("참가 중인 대결이 없어요.", "race_unavailable");
          if (
            data.action === "race:cancel" &&
            (race.status !== "waiting" || race.hostId !== playerId)
          )
            fail("대기 중인 대결만 취소할 수 있어요.", "race_unavailable");
          const winnerId = race.guestId
            ? race.hostId === playerId
              ? race.guestId
              : race.hostId
            : null;
          // This refund/payout and its request receipt must commit together.
          if (winnerId)
            balance.run(
              race.stake * 2,
              winnerId === race.hostId ? race.hostAccount : race.guestAccount,
            );
          else balance.run(race.stake, race.hostAccount);
          db.prepare("DELETE FROM escrows WHERE id = ?").run(race.id);
          effect = () => {
            races.delete(race.id);
            returnParticipants(race);
            refresh(race.hostId);
            refresh(race.guestId);
            broadcastRaces();
            broadcast({
              type: "race:finish",
              result: {
                raceId: race.id,
                hostId: race.hostId,
                guestId: race.guestId,
                winnerId,
                winnerNickname:
                  winnerId === race.hostId
                    ? race.hostNickname
                    : winnerId === race.guestId
                      ? race.guestNickname
                      : null,
                pot: winnerId ? race.stake * 2 : 0,
                reason: winnerId ? "forfeit" : "cancelled",
              },
            });
          };
        } else if (data.action === "spray") {
          if (time - peer.lastSprayAt < 2000)
            fail("스프레이는 2초 뒤에 다시 남길 수 있어요.", "rate_limited");
          const spray = {
            id: randomUUID(),
            playerId,
            nickname: peer.player.nickname,
            itemId: current.equipped.spray,
            x: peer.player.x,
            z: peer.player.z,
            createdAt: new Date(time).toISOString(),
          };
          effect = () => {
            peer.lastSprayAt = time;
            sprays.push(spray);
            if (sprays.length > 40) sprays.shift();
            broadcast({ type: "spray", spray });
          };
        }
        const response = { ...base, ok: true, ...details };
        if (
          data.action === "crate" ||
          data.action === "attendance:claim" ||
          data.action.startsWith("race:") ||
          data.action.startsWith("arena:")
        ) {
          db.prepare(
            "INSERT INTO receipts (account_id, request_id, signature, result) VALUES (?, ?, ?, ?)",
          ).run(peer.accountId, requestId, signature, JSON.stringify(response));
        }
        return response;
      });
      remember(result);
      effect();
      refresh(playerId);
      return { ...result, profile: profile(playerId) };
    } catch (error) {
      const response = {
        ...base,
        ok: false,
        code: error instanceof GameError ? error.code : "game_unavailable",
        message:
          error instanceof GameError
            ? error.message
            : "게임 정보를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.",
      };
      remember(response);
      return { ...response, profile: profile(playerId) };
    }
  }

  function shutdown() {
    if (closed) return;
    try {
      arena.shutdown();
      for (const race of [...races.values()])
        settle(race, null, "server_restart");
    } finally {
      closed = true;
      peers.clear();
      activeAccounts.clear();
      db.close();
    }
  }
  return {
    attach,
    detach,
    handle,
    profile,
    onMove,
    interact,
    resetLap,
    lapProgress,
    tick,
    snapshotRaces,
    snapshotArenas: arena.snapshot,
    snapshotArenaHonors: arena.snapshotHonors,
    arenaFor: arena.arenaFor,
    canMove: (id) =>
      arena.canMove(id) &&
      !(raceFor(id)?.status === "countdown" && now() < raceFor(id).startsAt),
    interactArena: arena.interact,
    shutdown,
    beforeTeleport: (id) =>
      !["countdown", "racing"].includes(raceFor(id)?.status) &&
      (!arena.arenaFor(id) || arena.arenaFor(id).status === "waiting"),
    isLocked: (id) => {
      const race = raceFor(id);
      return (
        !arena.canMove(id) ||
        (race?.status === "countdown" && now() < race.startsAt)
      );
    },
    recentSprays: () =>
      sprays
        .filter((spray) => now() - Date.parse(spray.createdAt) < 30_000)
        .map((spray) => ({ ...spray })),
  };
}
