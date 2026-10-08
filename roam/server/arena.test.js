import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { WebSocket } from "ws";
import { DatabaseSync } from "node:sqlite";
import { createGameEngine } from "./game.js";
import { createGameServer } from "./index.js";
import { trackPoint } from "../src/gameConfig.js";
import { ARENA, arenaRadius } from "../src/arenaConfig.js";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "roam-arena-test-"));
  let time = 1_700_000_000_000;
  const events = [],
    teleports = [],
    engines = [],
    cleanup = [];
  const start = () => {
    const game = createGameEngine({
      directory,
      now: () => time,
      random: () => 0,
      broadcast: (event) => events.push(event),
      teleport: (id, pose) => teleports.push({ id, pose }),
    });
    engines.push(game);
    return game;
  };
  const game = start();
  t.after(async () => {
    for (const task of cleanup) await task();
    for (const engine of engines) engine.shutdown();
    rmSync(directory, { recursive: true, force: true });
  });
  const advance = (ms) => {
    time += ms;
  };
  function attach(laps = 1, token, engine = game) {
    const player = {
      id: randomUUID(),
      nickname: `참가자 ${randomUUID().slice(0, 5)}`,
      ...trackPoint(0),
      y: 0,
    };
    const identity = engine.attach(player, token);
    for (let lap = 0; lap < laps; lap++)
      for (let step = 0; step <= 100; step++) {
        time += 100;
        Object.assign(player, trackPoint(step / 100));
        engine.onMove(player.id, player);
      }
    return { player, ...identity };
  }
  const action = (
    peer,
    action,
    values = {},
    requestId = randomUUID(),
    engine = game,
  ) =>
    engine.handle(peer.player.id, {
      type: "game",
      action,
      requestId,
      ...values,
    });
  function round(count = 2) {
    const users = Array.from({ length: count }, () => attach());
    const created = action(users[0], "arena:create");
    assert.equal(created.ok, true);
    for (const peer of users.slice(1))
      assert.equal(
        action(peer, "arena:join", { arenaId: created.arena.id }).ok,
        true,
      );
    return { users, id: created.arena.id };
  }
  const begin = ({ users, id }) => {
    const result = action(users[0], "arena:start", { arenaId: id });
    assert.equal(result.ok, true);
    advance(3000);
    game.tick();
    return result.arena;
  };
  const ringOut = (peer, radius = game.arenaFor(peer.player.id).radius) => {
    Object.assign(peer.player, {
      x: ARENA.cx + radius + 0.71,
      z: ARENA.cz,
      y: 0,
    });
    game.onMove(peer.player.id, peer.player);
  };
  return {
    directory,
    game,
    start,
    attach,
    advance,
    events,
    teleports,
    action,
    round,
    begin,
    ringOut,
    beforeCleanup: (task) => cleanup.push(task),
  };
}

function winRound(room, users) {
  const created = room.action(users[0], "arena:create");
  assert.equal(created.ok, true);
  const id = created.arena.id;
  for (const peer of users.slice(1))
    assert.equal(room.action(peer, "arena:join", { arenaId: id }).ok, true);
  room.begin({ users, id });
  for (const peer of users.slice(1)) room.ringOut(peer);
  room.game.tick();
  return id;
}

test("arena honors accumulate by account, retain nickname snapshots, rank wins, and persist across restart", (t) => {
  const room = fixture(t);
  assert.deepEqual(room.game.snapshotArenaHonors(), {
    latest: null,
    leaders: [],
    recent: [],
    total: 0,
  });
  const champion = room.attach();
  champion.player.nickname = "첫 번째 이름";
  const firstId = winRound(room, [champion, room.attach()]);
  const first = room.game.snapshotArenaHonors().latest;
  assert.deepEqual(first, {
    arenaId: firstId,
    nickname: "첫 번째 이름",
    wonAt: first.wonAt,
    players: 2,
    pot: 40,
  });
  assert.ok(Number.isSafeInteger(first.wonAt));
  champion.player.nickname = "같은 별명";
  const secondId = winRound(room, [champion, room.attach(), room.attach()]);
  const otherAccount = room.attach();
  otherAccount.player.nickname = "같은 별명";
  const thirdId = winRound(room, [otherAccount, room.attach()]);
  const honors = room.game.snapshotArenaHonors();
  assert.equal(honors.total, 3);
  assert.equal(honors.latest.arenaId, thirdId);
  assert.deepEqual(
    honors.recent.map((row) => row.arenaId),
    [thirdId, secondId, firstId],
  );
  assert.deepEqual(
    honors.leaders.map(({ nickname, wins }) => ({ nickname, wins })),
    [
      { nickname: "같은 별명", wins: 2 },
      { nickname: "같은 별명", wins: 1 },
    ],
    "two accounts with one nickname never merge",
  );
  assert.equal(honors.recent[2].nickname, "첫 번째 이름");
  assert.equal(honors.leaders[0].lastWonAt, honors.recent[1].wonAt);
  assert.deepEqual(Object.keys(honors.latest).sort(), [
    "arenaId",
    "nickname",
    "players",
    "pot",
    "wonAt",
  ]);
  assert.deepEqual(Object.keys(honors.leaders[0]).sort(), [
    "lastWonAt",
    "nickname",
    "wins",
  ]);
  assert.equal(
    room.events.filter((event) => event.type === "arena:honors").length,
    3,
  );
  for (let i = 0; i < 5; i++) room.game.tick();
  assert.deepEqual(room.game.snapshotArenaHonors(), honors);
  room.game.shutdown();
  const db = new DatabaseSync(join(room.directory, "game.sqlite"));
  try {
    assert.throws(
      () =>
        db.exec(`INSERT INTO arena_victories
      SELECT * FROM arena_victories LIMIT 1`),
      /UNIQUE/,
    );
  } finally {
    db.close();
  }
  const restored = room.start();
  assert.deepEqual(restored.snapshotArenaHonors(), honors);
});

test("honors publish the most recent twenty wins and top fifty accounts without inventing old records", (t) => {
  const room = fixture(t);
  const ids = [];
  for (let index = 0; index < 51; index++) {
    const winner = room.attach();
    winner.player.nickname = `우승자 ${index}`;
    ids.push(winRound(room, [winner, room.attach()]));
  }
  const honors = room.game.snapshotArenaHonors();
  assert.equal(honors.total, 51);
  assert.equal(honors.leaders.length, 50);
  assert.equal(honors.recent.length, 20);
  assert.equal(honors.latest.nickname, "우승자 50");
  assert.deepEqual(
    honors.recent.map((row) => row.arenaId),
    ids.slice(-20).reverse(),
  );
  assert.equal(honors.leaders[0].nickname, "우승자 50");
  assert.equal(honors.leaders.at(-1).nickname, "우승자 1");
});

test("draws, timeouts, cancellation and restart refunds never create victories", (t) => {
  const room = fixture(t);
  const draw = room.round();
  room.begin(draw);
  for (const peer of draw.users) room.ringOut(peer);
  room.game.tick();
  const timeout = room.round();
  room.begin(timeout);
  room.advance(180001);
  room.game.tick();
  const cancelling = room.attach();
  const waiting = room.action(cancelling, "arena:create").arena;
  room.action(cancelling, "arena:leave", { arenaId: waiting.id });
  room.begin(room.round());
  room.game.shutdown();
  const restored = room.start();
  assert.deepEqual(restored.snapshotArenaHonors(), {
    latest: null,
    leaders: [],
    recent: [],
    total: 0,
  });
  assert.equal(
    room.events.filter((event) => event.type === "arena:honors").length,
    0,
  );
});

test("a failed payout rolls back its victory insert and preserves recoverable escrow", (t) => {
  const room = fixture(t);
  const original = [room.attach(), room.attach()];
  room.game.shutdown();
  let db = new DatabaseSync(join(room.directory, "game.sqlite"));
  db.exec(`CREATE TRIGGER reject_arena_payout BEFORE UPDATE OF coins ON accounts
    WHEN NEW.coins > OLD.coins BEGIN SELECT RAISE(ABORT, 'simulated payout failure'); END;`);
  db.close();
  const game = room.start();
  const users = original.map((peer) => room.attach(0, peer.resumeToken, game));
  const action = (peer, name, values = {}) =>
    room.action(peer, name, values, randomUUID(), game);
  const id = action(users[0], "arena:create").arena.id;
  action(users[1], "arena:join", { arenaId: id });
  action(users[0], "arena:start", { arenaId: id });
  room.advance(3000);
  game.tick();
  Object.assign(users[1].player, {
    x: ARENA.cx + arenaRadius(2) + 1,
    z: ARENA.cz,
  });
  game.onMove(users[1].player.id, users[1].player);
  assert.throws(() => game.tick(), /simulated payout failure/);
  assert.equal(game.snapshotArenaHonors().total, 0);
  assert.equal(game.profile(users[0].player.id).coins, 0);
  assert.equal(game.snapshotArenas().length, 1);
  assert.throws(() => game.shutdown(), /simulated payout failure/);
  db = new DatabaseSync(join(room.directory, "game.sqlite"));
  try {
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM arena_escrows").get().count,
      2,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM arena_victories").get().count,
      0,
    );
    db.exec("DROP TRIGGER reject_arena_payout");
  } finally {
    db.close();
  }
  const recovered = room.start();
  for (const peer of original)
    assert.equal(room.attach(0, peer.resumeToken, recovered).profile.coins, 20);
  assert.equal(recovered.snapshotArenaHonors().total, 0);
});

test("arena entry is fixed at twenty coins, admits two to ten, and starts only once by its host", (t) => {
  const room = fixture(t);
  for (const count of [2, 10]) {
    const round = room.round(count);
    const host = round.users[0];
    const before = room.game.snapshotArenas()[0];
    assert.equal(before.radius, arenaRadius(count));
    assert.equal(before.pot, 20 * count);
    assert.equal(before.players.length, count);
    for (const peer of round.users)
      assert.equal(room.game.profile(peer.player.id).coins, 0);
    assert.equal(
      room.action(round.users[1], "arena:start", { arenaId: round.id }).code,
      "arena_not_host",
    );
    if (count === 10) {
      const extra = room.attach();
      assert.equal(
        room.action(extra, "arena:join", { arenaId: round.id }).code,
        "arena_full",
      );
      assert.equal(room.game.profile(extra.player.id).coins, 20);
    }
    const requestId = randomUUID();
    const started = room.action(
      host,
      "arena:start",
      { arenaId: round.id },
      requestId,
    );
    assert.equal(started.ok, true);
    assert.equal(started.arena.status, "countdown");
    assert.equal(room.game.canMove(host.player.id), false);
    assert.equal(room.game.beforeTeleport(host.player.id), false);
    assert.equal(room.teleports.length, count);
    for (const peer of round.users) {
      assert.ok(
        Math.abs(
          Math.hypot(peer.player.x - ARENA.cx, peer.player.z - ARENA.cz) -
            (started.arena.radius - ARENA.spawnClearance),
        ) < 1e-8,
      );
    }
    assert.deepEqual(
      room.action(host, "arena:start", { arenaId: round.id }, requestId).arena,
      started.arena,
    );
    assert.equal(room.teleports.length, count);
    assert.ok(started.arena.obstacles.length >= 6);
    assert.ok(started.arena.guards.length > 0);
    assert.ok(
      started.arena.obstacles.every((o) =>
        o.id.startsWith(`arena-${round.id}-`),
      ),
    );
    assert.ok(!JSON.stringify(started.arena).includes("accountId"));
    assert.ok(!JSON.stringify(started.arena).includes("returnPose"));
    room.advance(183001);
    room.game.tick();
    for (const peer of round.users)
      assert.equal(room.game.profile(peer.player.id).coins, 20);
    room.teleports.length = 0;
  }
});

test("waiting leave refunds once, transfers host, and admission rejects forged stakes or unavailable balances", (t) => {
  const room = fixture(t);
  const poor = room.attach(0);
  assert.equal(room.action(poor, "arena:create").code, "insufficient_coins");
  const host = room.attach(),
    guest = room.attach();
  assert.equal(
    room.action(host, "arena:create", { stake: 0 }).code,
    "invalid_game",
  );
  const createdId = randomUUID();
  const created = room.action(host, "arena:create", {}, createdId);
  assert.equal(
    room.action(host, "arena:create", {}, createdId).arena.id,
    created.arena.id,
  );
  assert.equal(room.game.profile(host.player.id).coins, 0);
  assert.equal(
    room.action(host, "arena:start", { arenaId: created.arena.id }).code,
    "arena_not_ready",
  );
  assert.equal(
    room.action(guest, "arena:join", { arenaId: created.arena.id }).ok,
    true,
  );
  const leaveId = randomUUID();
  assert.equal(
    room.action(host, "arena:leave", { arenaId: created.arena.id }, leaveId)
      .profile.coins,
    20,
  );
  assert.equal(
    room.action(host, "arena:leave", { arenaId: created.arena.id }, leaveId)
      .profile.coins,
    20,
  );
  assert.equal(room.game.snapshotArenas()[0].hostId, guest.player.id);
  assert.equal(room.game.snapshotArenas()[0].pot, 20);
  room.game.detach(guest.player.id);
  assert.deepEqual(room.game.snapshotArenas(), []);
  assert.equal(room.attach(0, guest.resumeToken).profile.coins, 20);
});

test("ring-outs produce spectators and one final survivor receives the whole pot exactly once", (t) => {
  const room = fixture(t),
    round = room.round(3);
  const original = round.users.map(({ player }) => ({
    x: player.x,
    y: player.y,
    z: player.z,
    heading: player.heading,
  }));
  room.begin(round);
  const [winner, first, last] = round.users;
  room.ringOut(first);
  assert.equal(room.game.canMove(first.player.id), false);
  assert.equal(
    room.game.snapshotArenas()[0].players.filter((p) => p.alive).length,
    3,
  );
  room.game.tick();
  assert.equal(
    room.game
      .arenaFor(first.player.id)
      .players.find((p) => p.id === first.player.id).alive,
    false,
  );
  assert.equal(room.game.beforeTeleport(first.player.id), false);
  assert.equal(room.game.canMove(winner.player.id), true);
  const lapCount = room.events.filter((event) => event.type === "lap").length;
  room.ringOut(last);
  room.game.tick();
  room.game.tick();
  assert.deepEqual(room.game.snapshotArenas(), []);
  assert.equal(room.game.profile(winner.player.id).coins, 60);
  assert.equal(room.game.profile(first.player.id).coins, 0);
  assert.equal(room.game.profile(last.player.id).coins, 0);
  assert.equal(
    room.events.filter((event) => event.type === "arena:finish").length,
    1,
  );
  assert.equal(room.events.at(-1).result.winnerId, winner.player.id);
  assert.equal(room.events.at(-1).result.pot, 60);
  assert.equal(
    room.events.filter((event) => event.type === "lap").length,
    lapCount,
  );
  round.users.forEach(({ player }, index) => {
    const { x, y, z, heading } = player;
    assert.deepEqual({ x, y, z, heading }, original[index]);
  });
});

test("all ring-outs in one authoritative tick draw and refund, even if an earlier car attempts to reenter", (t) => {
  const room = fixture(t),
    round = room.round();
  room.begin(round);
  room.ringOut(round.users[0]);
  Object.assign(round.users[0].player, { x: ARENA.cx, z: ARENA.cz });
  room.game.onMove(round.users[0].player.id, round.users[0].player);
  room.ringOut(round.users[1]);
  assert.equal(
    room.events.filter((event) => event.type === "arena:finish").length,
    0,
  );
  room.game.tick();
  assert.equal(room.events.at(-1).result.reason, "draw");
  assert.equal(room.events.at(-1).result.winnerId, null);
  for (const peer of round.users)
    assert.equal(room.game.profile(peer.player.id).coins, 20);
});

test("started disconnects forfeit, explicit leave is idempotent, and timeout refunds unresolved stakes", (t) => {
  const room = fixture(t),
    round = room.round(3);
  room.begin(round);
  const leaving = room.action(
    round.users[1],
    "arena:leave",
    { arenaId: round.id },
    "same-leave",
  );
  assert.equal(leaving.ok, true);
  assert.equal(
    room.action(
      round.users[1],
      "arena:leave",
      { arenaId: round.id },
      "same-leave",
    ).ok,
    true,
  );
  room.game.detach(round.users[2].player.id);
  room.game.tick();
  assert.equal(room.game.profile(round.users[0].player.id).coins, 60);
  assert.equal(room.attach(0, round.users[2].resumeToken).profile.coins, 0);
  const timeout = room.round();
  room.begin(timeout);
  room.advance(180001);
  room.game.tick();
  assert.equal(room.events.at(-1).result.reason, "timeout");
  for (const peer of timeout.users)
    assert.equal(room.game.profile(peer.player.id).coins, 20);
});

test("arena and legacy race memberships exclude each other, lock bodies, and share one active arena", (t) => {
  const room = fixture(t);
  const host = room.attach(6),
    guest = room.attach();
  const item = room.action(host, "crate").item;
  const created = room.action(host, "arena:create");
  assert.equal(
    room.action(host, "equip", { itemId: item.id }).code,
    "race_body_locked",
  );
  assert.equal(
    room.action(host, "race:create", { stake: 20 }).code,
    "already_racing",
  );
  assert.equal(
    room.action(guest, "arena:join", { arenaId: created.arena.id }).ok,
    true,
  );
  const other = room.round();
  room.begin({ users: [host, guest], id: created.arena.id });
  assert.equal(
    room.action(other.users[0], "arena:start", { arenaId: other.id }).code,
    "arena_busy",
  );
  room.action(guest, "arena:leave", { arenaId: created.arena.id });
  room.game.tick();
  room.begin(other);
  const racer = room.attach();
  assert.equal(room.action(racer, "race:create", { stake: 20 }).ok, true);
  assert.equal(room.action(racer, "arena:create").code, "already_racing");
});

test("arena pads validate the current round, membership, alive state, height, distance and per-pad cooldown", (t) => {
  const room = fixture(t),
    round = room.round(3),
    outsider = room.attach();
  const countdown = room.action(round.users[0], "arena:start", {
    arenaId: round.id,
  }).arena;
  const object = countdown.obstacles[0],
    host = round.users[0];
  assert.equal(
    room.game.interactArena(host.player.id, object.id).code,
    "arena_unavailable",
  );
  room.advance(3000);
  room.game.tick();
  assert.equal(
    room.game.interactArena(outsider.player.id, object.id).code,
    "arena_unavailable",
  );
  assert.equal(
    room.game.interactArena(host.player.id, "arena-fake").code,
    "invalid_interaction",
  );
  assert.equal(
    room.game.interactArena(host.player.id, object.id).code,
    "interaction_out_of_range",
  );
  Object.assign(host.player, { x: object.x, z: object.z, y: 4 });
  assert.equal(
    room.game.interactArena(host.player.id, object.id).code,
    "interaction_in_air",
  );
  host.player.y = 0;
  assert.deepEqual(room.game.interactArena(host.player.id, object.id).event, {
    type: "interaction",
    arenaId: round.id,
    objectId: object.id,
    kind: object.kind,
    playerId: host.player.id,
  });
  assert.equal(
    room.game.interactArena(host.player.id, object.id).code,
    "rate_limited",
  );
  const next = countdown.obstacles[1];
  Object.assign(host.player, { x: next.x, z: next.z });
  assert.equal(room.game.interactArena(host.player.id, next.id).ok, true);
  room.ringOut(host);
  room.game.tick();
  assert.equal(
    room.game.interactArena(host.player.id, next.id).code,
    "arena_unavailable",
  );
});

test("arena escrow survives abrupt process exit and recovers each stake once; graceful shutdown refunds too", (t) => {
  const room = fixture(t);
  room.game.shutdown();
  const script = `
    import { createGameEngine } from ${JSON.stringify(new URL("./game.js", import.meta.url).href)};
    import { trackPoint } from ${JSON.stringify(new URL("../src/gameConfig.js", import.meta.url).href)};
    let now=1700000000000;
    const game=createGameEngine({directory:process.argv[1],now:()=>now,random:()=>0});
    const users=[];
    for(let i=0;i<3;i++) { const player={id:'crash-'+i,nickname:'Crash '+i,...trackPoint(0),y:0};
      const identity=game.attach(player); users.push({player,...identity});
      for(let j=0;j<=100;j++){ now+=100; Object.assign(player,trackPoint(j/100)); game.onMove(player.id,player); }
    }
    const created=game.handle(users[0].player.id,{type:'game',action:'arena:create',requestId:'create'});
    for(const user of users.slice(1))game.handle(user.player.id,{type:'game',action:'arena:join',arenaId:created.arena.id,requestId:'join'});
    game.handle(users[0].player.id,{type:'game',action:'arena:start',arenaId:created.arena.id,requestId:'start'});
    process.stdout.write(JSON.stringify(users.map(user=>user.resumeToken)));
    process.exit(0);
  `;
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script, room.directory],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(child.status, 0, child.stderr);
  const tokens = JSON.parse(child.stdout);
  const recovered = room.start();
  for (const token of tokens)
    assert.equal(room.attach(0, token, recovered).profile.coins, 20);
  recovered.shutdown();
  const restarted = room.start();
  const resumed = tokens.map((token) => room.attach(0, token, restarted));
  for (const peer of resumed) assert.equal(peer.profile.coins, 20);
  const created = room.action(
    resumed[0],
    "arena:create",
    {},
    "fresh-create",
    restarted,
  );
  room.action(
    resumed[1],
    "arena:join",
    { arenaId: created.arena.id },
    "fresh-join",
    restarted,
  );
  restarted.shutdown();
  const again = room.start();
  for (const token of tokens)
    assert.equal(room.attach(0, token, again).profile.coins, 20);
});

test("real WebSocket arena validates forty-speed travel, rails, shared strong impacts, spectating and one payout", async (t) => {
  const room = fixture(t);
  const identities = [
    room.attach(),
    room.attach(),
    room.attach(),
    room.attach(0),
  ];
  room.game.shutdown();
  const server = createGameServer({
    allowedOrigins: ["http://localhost:5173"],
    playersDirectory: room.directory,
    galleryDirectory: join(room.directory, "gallery"),
  });
  const clients = [];
  room.beforeCleanup(async () => {
    clients.forEach((client) => client.socket.terminate());
    await new Promise((resolve) => server.close(resolve));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const honorsUrl = `http://127.0.0.1:${server.address().port}/api/arena/honors`;
  const initialHonors = await fetch(honorsUrl, {
    headers: { Origin: "http://localhost:5173" },
  });
  assert.equal(initialHonors.status, 200);
  assert.equal(
    initialHonors.headers.get("access-control-allow-origin"),
    "http://localhost:5173",
  );
  assert.equal(initialHonors.headers.get("cache-control"), "no-store");
  assert.deepEqual(await initialHonors.json(), {
    latest: null,
    leaders: [],
    recent: [],
    total: 0,
  });
  const otherOrigin = await fetch(honorsUrl, {
    headers: { Origin: "https://unapproved.example" },
  });
  assert.equal(otherOrigin.headers.get("access-control-allow-origin"), null);
  await otherOrigin.arrayBuffer();
  async function connect(identity, index) {
    const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`, {
      origin: "http://localhost:5173",
    });
    const peer = {
      socket,
      queue: [],
      waiters: [],
      player: null,
      errors: [],
      profile: null,
    };
    clients.push(peer);
    peer.send = (message) => socket.send(JSON.stringify(message));
    peer.wait = (predicate, timeout = 5000) => {
      const found = peer.queue.findIndex(predicate);
      if (found >= 0) return Promise.resolve(peer.queue.splice(found, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          resolve,
          timer: setTimeout(() => {
            peer.waiters = peer.waiters.filter((value) => value !== waiter);
            reject(new Error("Arena WebSocket response timed out"));
          }, timeout),
        };
        peer.waiters.push(waiter);
      });
    };
    socket.on("message", (raw) => {
      const message = JSON.parse(raw);
      if (message.type === "error") peer.errors.push(message.code);
      if (message.profile) peer.profile = message.profile;
      if (message.type === "welcome" || message.type === "teleport")
        peer.player = message.player;
      if (message.type === "state" && peer.player)
        peer.player =
          message.players.find((player) => player.id === peer.player.id) ||
          peer.player;
      const index = peer.waiters.findIndex(({ predicate }) =>
        predicate(message),
      );
      if (index >= 0) {
        const [waiter] = peer.waiters.splice(index, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      } else {
        peer.queue.push(message);
        if (peer.queue.length > 250) peer.queue.shift();
      }
    });
    await once(socket, "open");
    peer.send({
      type: "join",
      nickname: `경기장 검증 ${index}`,
      token: identity.resumeToken,
    });
    const welcome = await peer.wait((message) => message.type === "welcome");
    assert.deepEqual(welcome.arenas, []);
    assert.deepEqual(welcome.arenaHonors, {
      latest: null,
      leaders: [],
      recent: [],
      total: 0,
    });
    peer.origin = {
      x: welcome.player.x,
      y: welcome.player.y,
      z: welcome.player.z,
      heading: welcome.player.heading,
    };
    return peer;
  }
  const [host, rival, spectator, outsider] = await Promise.all(
    identities.map(connect),
  );
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function action(peer, action, values = {}) {
    const requestId = randomUUID();
    peer.send({ type: "game", action, requestId, ...values });
    const message = await peer.wait(
      (value) => value.type === "game:result" && value.requestId === requestId,
    );
    assert.equal(message.ok, true, message.message);
    return message;
  }
  async function moveTo(peer, target) {
    const from = { ...peer.player };
    const count = Math.max(
      1,
      Math.ceil(Math.hypot(target.x - from.x, target.z - from.z) / 2.8),
    );
    for (let step = 1; step <= count; step++) {
      await sleep(90);
      const pose = {
        x: from.x + ((target.x - from.x) * step) / count,
        z: from.z + ((target.z - from.z) * step) / count,
        y: target.y ?? 0,
        heading: 0,
      };
      peer.send({ type: "move", ...pose });
      await peer.wait(
        (message) =>
          message.type === "state" &&
          message.players.some(
            (p) =>
              p.id === peer.player.id &&
              Math.abs(p.x - pose.x) < 1e-8 &&
              Math.abs(p.z - pose.z) < 1e-8,
          ),
      );
    }
  }
  outsider.send({ type: "move", x: ARENA.cx, z: ARENA.cz, heading: 0 });
  assert.equal(
    (await outsider.wait((m) => m.type === "error")).code,
    "invalid_move",
  );
  const created = await action(host, "arena:create");
  const arenaId = created.arena.id;
  await action(rival, "arena:join", { arenaId });
  await action(spectator, "arena:join", { arenaId });
  const started = (await action(host, "arena:start", { arenaId })).arena;
  await Promise.all(
    [host, rival, spectator].map((peer) =>
      peer.wait((m) => m.type === "teleport"),
    ),
  );
  const spawn = { ...host.player };
  host.send({ type: "move", x: ARENA.cx, z: ARENA.cz, heading: 0 });
  await sleep(150);
  assert.equal(host.player.x, spawn.x);
  assert.equal(host.player.z, spawn.z);
  await host.wait(
    (m) =>
      m.type === "arena:state" &&
      m.arenas.some(
        (arena) => arena.id === arenaId && arena.status === "running",
      ),
  );
  await moveTo(host, { x: ARENA.cx + 3, z: ARENA.cz });
  let last;
  for (let step = 1; step <= 8; step++) {
    await sleep(80);
    const angle = (step * 38 * 0.08) / 3;
    last = {
      x: ARENA.cx + Math.cos(angle) * 3,
      z: ARENA.cz + Math.sin(angle) * 3,
      heading: -angle,
    };
    host.send({ type: "move", ...last });
  }
  await host.wait(
    (m) =>
      m.type === "state" &&
      m.players.some((p) => p.id === host.player.id && p.x === last.x),
  );
  await moveTo(host, { x: ARENA.cx - 3, z: ARENA.cz });
  await moveTo(rival, { x: ARENA.cx, z: ARENA.cz });
  await moveTo(host, { x: ARENA.cx - 2.5, z: ARENA.cz });
  await sleep(80);
  host.send({
    type: "move",
    x: ARENA.cx - 1.2,
    z: ARENA.cz,
    heading: Math.PI / 2,
  });
  const impact = await host.wait(
    (m) => m.type === "car:impact" && m.arenaId === arenaId,
  );
  assert.deepEqual(
    await rival.wait((m) => m.type === "car:impact" && m.id === impact.id),
    impact,
  );
  assert.ok(Math.abs(impact.participants[0].vx) > 10);
  assert.ok(Math.abs(impact.participants[0].vx) <= 24.5);
  await moveTo(host, { x: ARENA.cx - 4, z: ARENA.cz - 3 });
  await moveTo(rival, { x: ARENA.cx + 4, z: ARENA.cz - 3 });
  const radial = (angle, distance, y = 0) => ({
    x: ARENA.cx + Math.cos(angle) * distance,
    z: ARENA.cz + Math.sin(angle) * distance,
    y,
  });
  const gap = started.guards[0].angle + Math.PI / 4;
  await moveTo(spectator, { x: ARENA.cx, z: ARENA.cz });
  await moveTo(spectator, radial(gap, started.radius + 0.85));
  await spectator.wait(
    (m) =>
      m.type === "arena:state" &&
      m.arenas.some((arena) =>
        arena.players.some((p) => p.id === spectator.player.id && !p.alive),
      ),
  );
  const outPose = { ...spectator.player };
  spectator.send({ type: "move", x: ARENA.cx, z: ARENA.cz, heading: 0 });
  await sleep(150);
  assert.equal(spectator.player.x, outPose.x);
  assert.deepEqual(spectator.errors, []);
  spectator.send({ type: "interaction", objectId: started.obstacles[0].id });
  assert.equal(
    (await spectator.wait((m) => m.type === "error")).code,
    "arena_unavailable",
  );
  spectator.send({ type: "teleport", destination: "start" });
  assert.equal(
    (await spectator.wait((m) => m.type === "error")).operation,
    "teleport",
  );
  await moveTo(host, { x: ARENA.cx, z: ARENA.cz });
  await moveTo(host, radial(started.guards[0].angle, started.radius - 1.1));
  host.send({
    type: "move",
    ...radial(started.guards[0].angle, started.radius + 0.5),
    heading: 0,
  });
  assert.equal(
    (await host.wait((m) => m.type === "error")).code,
    "invalid_move",
  );
  await moveTo(rival, { x: ARENA.cx, z: ARENA.cz, y: 3 });
  await moveTo(rival, radial(started.guards[1].angle, started.radius - 1.1, 3));
  await sleep(90);
  rival.send({
    type: "move",
    ...radial(started.guards[1].angle, started.radius + 0.85, 3),
    heading: 0,
  });
  const finished = await host.wait((m) => m.type === "arena:finish");
  assert.equal(finished.result.winnerId, host.player.id);
  assert.equal(finished.result.pot, 60);
  const honorEvent = await host.wait((m) => m.type === "arena:honors");
  assert.equal(honorEvent.honors.total, 1);
  assert.equal(honorEvent.honors.latest.arenaId, arenaId);
  assert.equal(honorEvent.honors.latest.nickname, host.player.nickname);
  assert.equal(honorEvent.honors.latest.players, 3);
  assert.equal(honorEvent.honors.latest.pot, 60);
  assert.deepEqual(await (await fetch(honorsUrl)).json(), honorEvent.honors);
  // A last packet from the old arena may already have been sent at settlement.
  rival.send({
    type: "move",
    ...radial(started.guards[1].angle, started.radius + 1, 3),
    heading: 0,
  });
  await sleep(150);
  assert.equal(host.profile.coins, 60);
  assert.equal(rival.profile.coins, 0);
  assert.equal(spectator.profile.coins, 0);
  assert.deepEqual(host.errors, ["invalid_move"]);
  assert.deepEqual(rival.errors, []);
  for (const peer of [host, rival, spectator]) {
    const { x, y, z, heading } = peer.player;
    assert.deepEqual({ x, y, z, heading }, peer.origin);
  }
});
