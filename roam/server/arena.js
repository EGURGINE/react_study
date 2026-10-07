import { randomUUID } from "node:crypto";
import {
  ARENA,
  ARENA_OBSTACLE_RULES,
  arenaRadius,
  arenaSpawn,
  createArenaLayout,
} from "../src/arenaConfig.js";

const WAIT_MS = 180_000;
const ROUND_MS = 180_000;
const COUNTDOWN_MS = 3000;

/** Uses the game engine's existing transaction and request-receipt boundary. */
export function createArenaController({
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
  hasRace,
}) {
  db.exec(`CREATE TABLE IF NOT EXISTS arena_escrows (
    arena_id TEXT NOT NULL, account_id TEXT NOT NULL REFERENCES accounts(id),
    stake INTEGER NOT NULL CHECK (stake = 20),
    PRIMARY KEY (arena_id, account_id)
  );
  CREATE TABLE IF NOT EXISTS arena_victories (
    arena_id TEXT PRIMARY KEY,
    winner_account TEXT NOT NULL REFERENCES accounts(id),
    winner_nickname TEXT NOT NULL,
    players INTEGER NOT NULL CHECK (players BETWEEN 2 AND 10),
    pot INTEGER NOT NULL CHECK (pot > 0),
    won_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS arena_victories_winner
    ON arena_victories(winner_account, won_at DESC);
  CREATE INDEX IF NOT EXISTS arena_victories_time
    ON arena_victories(won_at DESC);`);
  transaction(() => {
    for (const row of db.prepare("SELECT * FROM arena_escrows").all())
      balance.run(row.stake, row.account_id);
    db.exec("DELETE FROM arena_escrows");
  });
  const arenas = new Map();
  const recordVictory = db.prepare(`
    INSERT INTO arena_victories
      (arena_id, winner_account, winner_nickname, players, pot, won_at)
    SELECT ?, ?, ?, ?, ?, ? WHERE ? > 0
    ON CONFLICT(arena_id) DO NOTHING
  `);
  const recentVictories = db.prepare(`
    SELECT arena_id AS arenaId, winner_nickname AS nickname,
      won_at AS wonAt, players, pot
    FROM arena_victories ORDER BY won_at DESC, rowid DESC LIMIT 20
  `);
  const victoryCount = db.prepare(
    "SELECT COUNT(*) AS total FROM arena_victories",
  );
  const victoryLeaders = db.prepare(`
    WITH ranked AS (
      SELECT winner_nickname AS nickname, won_at AS lastWonAt,
        COUNT(*) OVER (PARTITION BY winner_account) AS wins,
        ROW_NUMBER() OVER (
          PARTITION BY winner_account ORDER BY won_at DESC, rowid DESC
        ) AS newest,
        rowid AS sequence
      FROM arena_victories
    )
    SELECT nickname, wins, lastWonAt FROM ranked WHERE newest = 1
    ORDER BY wins DESC, lastWonAt DESC, sequence DESC LIMIT 50
  `);
  function snapshotHonors() {
    // Only these explicit public columns leave the persistent account ledger.
    const recent = recentVictories.all().map((row) => ({ ...row }));
    return {
      latest: recent[0] || null,
      leaders: victoryLeaders.all().map((row) => ({ ...row })),
      recent,
      total: victoryCount.get().total,
    };
  }
  const lookup = (id) =>
    [...arenas.values()].find((arena) =>
      arena.players.some((p) => p.id === id),
    );
  const visible = (arena) => ({
    id: arena.id,
    hostId: arena.hostId,
    hostNickname: arena.hostNickname,
    status: arena.status,
    stake: ARENA.stake,
    pot: arena.players.length * ARENA.stake,
    radius: arena.radius,
    players: arena.players.map(({ id, nickname, alive }) => ({
      id,
      nickname,
      alive,
    })),
    obstacles: arena.obstacles.map((item) => ({ ...item })),
    guards: arena.guards.map((guard) => ({ ...guard })),
    startsAt: arena.startsAt,
    expiresAt: arena.expiresAt,
  });
  const snapshot = () => [...arenas.values()].map(visible);
  const publish = () => broadcast({ type: "arena:state", arenas: snapshot() });
  const arenaFor = (id) => {
    const arena = lookup(id);
    return arena ? visible(arena) : null;
  };
  const canMove = (id) => {
    const arena = lookup(id);
    if (!arena || arena.status === "waiting") return true;
    const player = arena.players.find((p) => p.id === id);
    return arena.status === "running" && player.alive && !player.pendingOut;
  };
  const restore = (arena) => {
    for (const player of arena.players) {
      const peer = peers.get(player.id);
      if (!peer) continue;
      resetLap(player.id);
      if (player.returnPose) {
        Object.assign(peer.player, player.returnPose);
        teleport(player.id, { ...player.returnPose });
      }
    }
  };
  function finish(arena, winnerId, reason) {
    if (!arenas.has(arena.id)) return;
    const escrow = db
      .prepare("SELECT * FROM arena_escrows WHERE arena_id = ?")
      .all(arena.id);
    const winner = arena.players.find((p) => p.id === winnerId);
    const pot = escrow.reduce((total, row) => total + row.stake, 0);
    let recorded = false;
    transaction(() => {
      if (winner) {
        recorded =
          recordVictory.run(
            arena.id,
            winner.accountId,
            winner.nickname,
            arena.players.length,
            pot,
            now(),
            pot,
          ).changes > 0;
        // One durable victory and its payout share the same commit. A repeated
        // resolution of this arena ID cannot increment either a second time.
        if (recorded) balance.run(pot, winner.accountId);
      } else for (const row of escrow) balance.run(row.stake, row.account_id);
      db.prepare("DELETE FROM arena_escrows WHERE arena_id = ?").run(arena.id);
    });
    arenas.delete(arena.id);
    restore(arena);
    // A forfeited browser may reconnect under a new socket/player ID while
    // this round is still unresolved. Its account still receives any refund.
    const accounts = new Set(arena.players.map((player) => player.accountId));
    for (const [id, peer] of peers)
      if (accounts.has(peer.accountId)) refresh(id);
    publish();
    if (recorded) broadcast({ type: "arena:honors", honors: snapshotHonors() });
    broadcast({
      type: "arena:finish",
      result: {
        arenaId: arena.id,
        participantIds: arena.players.map((p) => p.id),
        winnerId: winner?.id || null,
        winnerNickname: winner?.nickname || null,
        pot: winner ? pot : 0,
        reason,
      },
    });
  }
  function member(id) {
    const peer = peers.get(id);
    return {
      id,
      nickname: peer.player.nickname,
      accountId: peer.accountId,
      alive: true,
      pendingOut: false,
      returnPose: null,
      hits: new Map(),
    };
  }
  function reserve(arenaId, peer) {
    if (profile(peer.player.id).coins < ARENA.stake)
      fail("생존전에 참가하려면 코인 20개가 필요해요.", "insufficient_coins");
    balance.run(-ARENA.stake, peer.accountId);
    db.prepare(
      "INSERT INTO arena_escrows (arena_id, account_id, stake) VALUES (?, ?, ?)",
    ).run(arenaId, peer.accountId, ARENA.stake);
  }
  // Called inside the outer request transaction. Memory and broadcasts change
  // only after the stake/refund and its idempotency receipt have committed.
  function plan(id, data, time) {
    const peer = peers.get(id);
    if (data.action === "arena:create") {
      if (lookup(id) || hasRace(id))
        fail("이미 참가 중인 경기가 있어요.", "already_racing");
      const arena = {
        id: randomUUID(),
        hostId: id,
        hostNickname: peer.player.nickname,
        status: "waiting",
        players: [member(id)],
        radius: arenaRadius(1),
        obstacles: [],
        guards: [],
        startsAt: null,
        expiresAt: time + WAIT_MS,
      };
      reserve(arena.id, peer);
      return {
        details: { arena: visible(arena) },
        effect: () => {
          arenas.set(arena.id, arena);
          publish();
        },
      };
    }
    const arena = arenas.get(data.arenaId);
    if (!arena || time >= arena.expiresAt)
      fail("참가할 수 없는 생존전이에요.", "arena_unavailable");
    if (data.action === "arena:join") {
      if (lookup(id) || hasRace(id))
        fail("이미 참가 중인 경기가 있어요.", "already_racing");
      if (arena.status !== "waiting")
        fail("이미 시작된 생존전이에요.", "arena_unavailable");
      if (arena.players.length >= ARENA.maxPlayers)
        fail("생존전 참가 인원이 가득 찼어요.", "arena_full");
      reserve(arena.id, peer);
      const joined = {
        ...arena,
        players: [...arena.players, member(id)],
        radius: arenaRadius(arena.players.length + 1),
      };
      return {
        details: { arena: visible(joined) },
        effect: () => {
          arenas.set(arena.id, joined);
          publish();
        },
      };
    }
    const participant = arena.players.find((p) => p.id === id);
    if (!participant) fail("참가 중인 생존전이 아니에요.", "arena_unavailable");
    if (data.action === "arena:start") {
      if (arena.hostId !== id || arena.status !== "waiting")
        fail("방장만 대기 중인 생존전을 시작할 수 있어요.", "arena_not_host");
      if (arena.players.length < ARENA.minPlayers)
        fail("두 명 이상 모이면 시작할 수 있어요.", "arena_not_ready");
      if (
        [...arenas.values()].some(
          (other) => other.id !== arena.id && other.status !== "waiting",
        )
      )
        fail(
          "경기장에서 다른 생존전이 진행 중이에요. 끝난 뒤 시작해 주세요.",
          "arena_busy",
        );
      const layout = createArenaLayout(arena.players.length, random);
      const started = {
        ...arena,
        radius: layout.radius,
        status: "countdown",
        startsAt: time + COUNTDOWN_MS,
        expiresAt: time + COUNTDOWN_MS + ROUND_MS,
        obstacles: layout.obstacles.map((item) => ({
          ...item,
          id: `arena-${arena.id}-${item.id}`,
        })),
        guards: layout.guards.map((guard) => ({
          ...guard,
          id: `arena-${arena.id}-${guard.id}`,
        })),
        players: arena.players.map((player) => {
          const { x, y = 0, z, heading } = peers.get(player.id).player;
          return { ...player, returnPose: { x, y, z, heading } };
        }),
      };
      return {
        details: { arena: visible(started) },
        effect: () => {
          arenas.set(arena.id, started);
          for (const [index, player] of started.players.entries()) {
            resetLap(player.id);
            const pose = arenaSpawn(
              index,
              started.players.length,
              started.radius,
            );
            Object.assign(peers.get(player.id).player, pose);
            teleport(player.id, pose);
          }
          publish();
        },
      };
    }
    if (data.action === "arena:leave") {
      if (arena.status === "waiting") {
        const returned = db
          .prepare(
            "DELETE FROM arena_escrows WHERE arena_id = ? AND account_id = ?",
          )
          .run(arena.id, peer.accountId).changes;
        if (returned) balance.run(ARENA.stake, peer.accountId);
        const remaining = arena.players.filter((p) => p.id !== id);
        const changed = {
          ...arena,
          players: remaining,
          radius: arenaRadius(remaining.length),
          hostId: remaining[0]?.id,
          hostNickname: remaining[0]?.nickname,
        };
        return {
          details: { arena: remaining.length ? visible(changed) : null },
          effect: () => {
            if (remaining.length) arenas.set(arena.id, changed);
            else arenas.delete(arena.id);
            publish();
            if (!remaining.length)
              broadcast({
                type: "arena:finish",
                result: {
                  arenaId: arena.id,
                  participantIds: [id],
                  winnerId: null,
                  winnerNickname: null,
                  pot: 0,
                  reason: "cancelled",
                },
              });
          },
        };
      }
      return {
        details: {
          arena: visible({
            ...arena,
            players: arena.players.map((p) =>
              p.id === id ? { ...p, alive: false } : p,
            ),
          }),
        },
        effect: () => {
          participant.alive = false;
          participant.pendingOut = false;
          publish();
        },
      };
    }
    fail("지원하지 않는 생존전 요청이에요.", "invalid_game");
  }
  function detach(id) {
    const arena = lookup(id);
    if (!arena) return;
    if (arena.status === "waiting") {
      const result = transaction(() =>
        plan(id, { action: "arena:leave", arenaId: arena.id }, now()),
      );
      result.effect();
    } else {
      const player = arena.players.find((p) => p.id === id);
      player.alive = false;
      player.pendingOut = false;
      publish();
    }
  }
  function observe(id, pose) {
    const arena = lookup(id);
    if (!arena || arena.status === "waiting") return false;
    const player = arena.players.find((p) => p.id === id);
    if (
      arena.status === "running" &&
      player.alive &&
      Math.hypot(pose.x - ARENA.cx, pose.z - ARENA.cz) > arena.radius + 0.7
    )
      player.pendingOut = true;
    return true;
  }
  function tick() {
    const time = now();
    for (const arena of [...arenas.values()]) {
      if (time >= arena.expiresAt) {
        finish(arena, null, "timeout");
        continue;
      }
      if (arena.status === "waiting") continue;
      let changed = false;
      if (arena.status === "countdown" && time >= arena.startsAt) {
        arena.status = "running";
        changed = true;
      }
      // Resolve all accepted poses together. No packet gets declared the winner
      // before another ring-out in the same authoritative tick is examined.
      for (const player of arena.players) {
        const pose = peers.get(player.id)?.player;
        if (
          player.alive &&
          (!pose ||
            player.pendingOut ||
            (arena.status === "running" &&
              Math.hypot(pose.x - ARENA.cx, pose.z - ARENA.cz) >
                arena.radius + 0.7))
        ) {
          player.alive = false;
          player.pendingOut = false;
          changed = true;
        }
      }
      const alive = arena.players.filter((p) => p.alive);
      if (alive.length <= 1)
        finish(arena, alive[0]?.id, alive.length ? "finished" : "draw");
      else if (changed) publish();
    }
  }
  function interact(id, objectId) {
    try {
      const arena = lookup(id);
      const participant = arena?.players.find((p) => p.id === id);
      if (
        !arena ||
        arena.status !== "running" ||
        !participant?.alive ||
        participant.pendingOut
      )
        fail(
          "출발한 생존전의 생존자만 장치를 사용할 수 있어요.",
          "arena_unavailable",
        );
      const object = arena.obstacles.find((item) => item.id === objectId);
      if (!object)
        fail("이 생존전의 장치를 선택해 주세요.", "invalid_interaction");
      const pose = peers.get(id).player;
      const rule = ARENA_OBSTACLE_RULES[object.kind];
      if (Math.hypot(pose.x - object.x, pose.z - object.z) > object.r + 2)
        fail("장치에 조금 더 가까이 가 주세요.", "interaction_out_of_range");
      if ((pose.y || 0) > rule.maxTriggerHeight + 0.85)
        fail("공중에서는 장치를 다시 밟을 수 없어요.", "interaction_in_air");
      const time = now();
      if (
        time - (participant.hits.get(objectId) ?? -Infinity) <
        rule.cooldownMs
      )
        fail("이 장치는 잠시 뒤 다시 사용할 수 있어요.", "rate_limited");
      participant.hits.set(objectId, time);
      const event = {
        type: "interaction",
        arenaId: arena.id,
        objectId,
        kind: object.kind,
        playerId: id,
      };
      broadcast(event);
      return { ok: true, event };
    } catch (error) {
      return {
        ok: false,
        code: error.code || "game_unavailable",
        message: error.message,
      };
    }
  }
  return {
    plan,
    snapshot,
    snapshotHonors,
    arenaFor,
    canMove,
    observe,
    tick,
    detach,
    interact,
    has: (id) => Boolean(lookup(id)),
    shutdown: () => {
      for (const arena of [...arenas.values()])
        finish(arena, null, "server_restart");
    },
  };
}
