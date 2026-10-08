import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createGameEngine } from "./game.js";
import { isDriveable } from "../src/gameConfig.js";
import {
  FUEL,
  garageSlot,
  garagePoint,
  garageLocal,
  isGarageDriveable,
  garageDoorContact,
  getFuelEconomy,
} from "../src/fuelConfig.js";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "roam-fuel-"));
  let time = 1800000001000;
  const events = [];
  const engines = [];
  let game;
  const start = () => {
    game = createGameEngine({
      directory,
      now: () => time,
      random: () => 0,
      broadcast: (value) => events.push(value),
      teleport: (id, pose) => events.push({ type: "teleport", id, pose }),
    });
    engines.push(game);
    return game;
  };
  start();
  t.after(() => {
    engines.forEach((engine) => engine.shutdown());
    rmSync(directory, { recursive: true, force: true });
  });
  const attach = (token) => {
    const player = {
      id: randomUUID(),
      nickname: "연료 검증",
      color: "#abcdef",
      x: 0,
      y: 0,
      z: 0,
      heading: 0,
    };
    return { player, ...game.attach(player, token) };
  };
  const advance = (ms, tick = true) => {
    time += ms;
    if (tick) game.tick();
  };
  const move = (
    user,
    point = user.player,
    manualBoost = false,
    milliseconds = 100,
  ) => {
    advance(milliseconds, false);
    Object.assign(user.player, point);
    game.observeFuel(
      user.player.id,
      user.player,
      manualBoost,
      milliseconds / 1000,
    );
    game.tick();
  };
  const garage = (user) =>
    game
      .snapshotFuel()
      .garages.find((value) => value.ownerId === user.player.id);
  const player = (user) =>
    game.snapshotFuel().players.find((value) => value.id === user.player.id);
  const pump = (user) =>
    garagePoint(garage(user).slot, FUEL.pumpAcross, FUEL.pumpOutward);
  const action = (user, action, values = {}, requestId = randomUUID()) =>
    game.handle(user.player.id, { type: "game", action, requestId, ...values });
  const hold = (user, ms = 3100) => {
    for (let i = 0; i < ms; i += 100) move(user);
  };
  const steal = (thief, owner) => {
    move(thief, pump(owner));
    move(thief);
    assert.equal(
      action(thief, "fuel:steal", { targetId: owner.player.id }).ok,
      true,
    );
    hold(thief);
  };
  const sql = (work) => {
    game.shutdown();
    const db = new DatabaseSync(join(directory, "game.sqlite"));
    try {
      work(db);
    } finally {
      db.close();
    }
    start();
  };
  return {
    get game() {
      return game;
    },
    attach,
    advance,
    move,
    garage,
    player,
    pump,
    action,
    hold,
    steal,
    sql,
    start,
    events,
  };
}

test("garage geometry, owner gates and independent body fuel economy share precise coordinates", () => {
  for (let slot = 0; slot < 10; slot += 1) {
    const garage = garageSlot(slot);
    assert.ok(Math.abs(Math.hypot(garage.x, garage.z) - FUEL.radius) < 1e-10);
    const point = garagePoint(slot, 0.8, 0.2);
    const local = garageLocal(slot, point.x, point.z);
    assert.ok(Math.abs(local.across - 0.8) < 1e-10);
    assert.ok(isGarageDriveable(point.x, point.z, slot));
    const pad = garagePoint(slot, FUEL.closeAcross, FUEL.closeOutward);
    assert.ok(isGarageDriveable(pad.x, pad.z, slot));
    const before = garagePoint(slot, 0, -3.2);
    const after = garagePoint(slot, 0, 0.3);
    const gate = { slot, ownerId: "owner", closedUntil: 30000 };
    assert.ok(garageDoorContact(before, after, gate, "visitor", 1000));
    assert.equal(garageDoorContact(before, after, gate, "owner", 1000), null);
    assert.equal(
      garageDoorContact(before, after, gate, "visitor", 30000),
      null,
    );
  }
  const starter = getFuelEconomy("body-starter");
  assert.equal(starter.consumptionRate, 10);
  assert.equal(starter.boostSeconds, 10);
  assert.ok(getFuelEconomy("body-mythic-apex").consumptionRate < 10);
  assert.deepEqual(getFuelEconomy("forged-body"), starter);
});

test("accounts receive one initial tank, online garages produce together and offline time never accrues", (t) => {
  const room = fixture(t);
  const owner = room.attach();
  const other = room.attach();
  assert.equal(room.player(owner).tank, 100);
  assert.equal(room.garage(owner).stored, 0);
  assert.notEqual(room.garage(owner).slot, room.garage(other).slot);
  const next = room.game.snapshotFuel().nextProductionAt;
  room.advance(next - room.game.snapshotFuel().serverNow);
  assert.equal(room.garage(owner).stored, 20);
  assert.equal(room.garage(other).stored, 20);
  room.advance(60000 * 15);
  assert.equal(room.garage(owner).stored, 200);
  room.game.detach(owner.player.id);
  room.advance(60000 * 100);
  const resumed = room.attach(owner.resumeToken);
  assert.equal(room.garage(resumed).stored, 200);
  assert.equal(room.player(resumed).tank, 100);
  assert.equal(room.garage(resumed).closedUntil, 0);
});

test("active garage perimeter walls stop owners, visitors and airborne cars while the entry remains open", (t) => {
  const room = fixture(t);
  const owner = room.attach();
  const visitor = room.attach();
  const { slot } = room.garage(owner);
  const center = garagePoint(slot);
  // This thin strip is valid platform ground but lies inside the solid wall's
  // car clearance, so endpoint-only floor checks used to allow crossing it.
  const rim = garagePoint(slot, 0, FUEL.padRadius - FUEL.carRadius - 0.05);
  assert.ok(room.game.fuelDriveable(rim.x, rim.z));
  for (const id of [owner.player.id, visitor.player.id]) {
    for (const y of [0, 8]) {
      const contact = room.game.fuelDoorContact(
        { ...center, y },
        { ...rim, y },
        id,
      );
      assert.equal(contact?.kind, "wall");
      assert.ok(Math.hypot(contact.x - rim.x, contact.z - rim.z) > 0.03);
    }
  }
  const bridge = garagePoint(slot, 0, FUEL.bridgeStart - FUEL.radius);
  assert.equal(
    room.game.fuelDoorContact(bridge, center, visitor.player.id),
    null,
  );
  assert.equal(
    room.game.fuelDoorContact(center, bridge, owner.player.id),
    null,
  );
  const outside = garagePoint(
    slot,
    FUEL.bridgeHalfWidth + 0.95,
    FUEL.bridgeStart - FUEL.radius,
  );
  assert.ok(isDriveable(outside.x, outside.z));
  assert.ok(isDriveable(bridge.x, bridge.z));
  assert.equal(
    room.game.fuelDoorContact(outside, bridge, owner.player.id)?.kind,
    "wall",
  );
  // Empty garage slots never leave an invisible wall behind after departure.
  room.game.detach(owner.player.id);
  assert.equal(
    room.game.fuelDoorContact(outside, bridge, visitor.player.id),
    null,
  );
});

test("moving manual boost spends fuel including delayed packets, idle stalls do not, and reconnect keeps the tank", (t) => {
  const room = fixture(t);
  const user = room.attach();
  room.move(user, { x: 1, z: 0 }, false);
  assert.equal(room.player(user).tank, 100);
  room.move(user, user.player, true);
  assert.equal(room.player(user).tank, 100);
  for (let i = 0; i < 50; i += 1)
    room.move(user, { x: user.player.x + 0.5, z: 0 }, true);
  assert.equal(room.player(user).tank, 50);
  room.advance(6000);
  assert.equal(room.player(user).tank, 50);
  room.move(user, { x: user.player.x + 2, z: 0 }, true, 1000);
  assert.equal(room.player(user).tank, 47.5);
  room.game.detach(user.player.id);
  const resumed = room.attach(user.resumeToken);
  assert.equal(room.player(resumed).tank, 47.5);
  room.game.shutdown();
  room.start();
  const restarted = room.attach(user.resumeToken);
  assert.equal(room.player(restarted).tank, 47.5);
});

test("own pump transfers at twenty per second only while stationary and connected", (t) => {
  const room = fixture(t);
  const owner = room.attach();
  room.advance(60000 * 5);
  for (let i = 0; i < 100; i += 1)
    room.move(owner, { x: owner.player.x + 0.4, z: 0 }, true);
  assert.equal(room.player(owner).tank, 0);
  room.move(owner, room.pump(owner));
  room.hold(owner, 1000);
  assert.ok(room.player(owner).tank >= 12 && room.player(owner).tank <= 20);
  const filled = room.player(owner).tank;
  room.advance(10000);
  assert.equal(room.player(owner).tank, filled);
  const pump = room.pump(owner);
  for (let i = 0; i < 8; i += 1)
    room.move(owner, { x: pump.x + (i % 2 ? -0.4 : 0.4), z: pump.z });
  assert.equal(room.player(owner).tank, filled);
});

test("300ms boost packets and instant delivery batches pay for their accepted travel without charging idle time", (t) => {
  const room = fixture(t);
  const user = room.attach();
  for (let i = 0; i < 10; i += 1)
    room.move(user, { x: user.player.x + 3.9, z: 0 }, true, 300);
  assert.equal(room.player(user).tank, 70);
  for (let i = 0; i < 10; i += 1)
    room.move(user, { x: user.player.x + 1.3, z: 0 }, true, 0);
  assert.equal(room.player(user).tank, 60);
  room.advance(60000);
  assert.equal(room.player(user).tank, 60);
  room.move(user, user.player, true, 300);
  assert.equal(room.player(user).tank, 60);
});

test("departing garage owners restore visitors to the island without losing their accounts or stranding them", (t) => {
  const room = fixture(t);
  const owner = room.attach();
  const visitor = room.attach();
  room.move(visitor, room.pump(owner));
  assert.ok(room.game.fuelDriveable(visitor.player.x, visitor.player.z));
  room.game.detach(owner.player.id);
  assert.ok(
    Math.abs(
      Math.hypot(visitor.player.x, visitor.player.z) - FUEL.bridgeStart,
    ) < 1e-8,
  );
  assert.ok(
    room.events.some(
      (event) => event.type === "teleport" && event.id === visitor.player.id,
    ),
  );
  room.move(visitor, { x: visitor.player.x + 0.1, z: visitor.player.z }, true);
  assert.equal(room.player(visitor).tank, 99);
});

test("clock rollback cannot repeat a production tick and new slots never gain offline production", (t) => {
  const room = fixture(t);
  const owner = room.attach();
  room.advance(60000);
  assert.equal(room.garage(owner).stored, 20);
  room.advance(-60000);
  room.advance(60000);
  assert.equal(room.garage(owner).stored, 20);
  room.game.detach(owner.player.id);
  room.advance(600000);
  const back = room.attach(owner.resumeToken);
  assert.equal(room.garage(back).stored, 20);
  room.advance(60000);
  assert.equal(room.garage(back).stored, 40);
});

test("holding theft three seconds debits once, leaves the tank unchanged, and delivers to the thief's own garage", (t) => {
  const room = fixture(t);
  const owner = room.attach();
  const thief = room.attach();
  room.advance(60000 * 2);
  room.steal(thief, owner);
  assert.equal(room.garage(owner).stored, 15);
  assert.equal(room.player(thief).tank, 100);
  assert.equal(room.player(thief).carrying.amount, 25);
  assert.equal(room.player(thief).carrying.sourceOwnerId, owner.player.id);
  room.hold(thief);
  assert.equal(room.garage(owner).stored, 15);
  room.move(thief, room.pump(thief));
  assert.equal(room.player(thief).carrying, null);
  assert.equal(room.garage(thief).stored, 65);
  assert.equal(room.player(thief).tank, 100);
});

test("release, stale inputs, movement and owner closing the door all cancel theft", (t) => {
  const room = fixture(t);
  const owner = room.attach();
  const thief = room.attach();
  room.advance(120000);
  const begin = () => {
    room.move(thief, room.pump(owner));
    room.move(thief);
    assert.equal(
      room.action(thief, "fuel:steal", { targetId: owner.player.id }).ok,
      true,
    );
  };
  begin();
  room.hold(thief, 1000);
  assert.equal(room.action(thief, "fuel:cancel", {}, "cancel-once").ok, true);
  assert.equal(room.action(thief, "fuel:cancel", {}, "cancel-once").ok, true);
  room.hold(thief);
  assert.equal(room.player(thief).carrying, null);
  begin();
  room.advance(600);
  assert.equal(room.player(thief).stealing, null);
  begin();
  room.move(thief, { x: 0, z: 0 });
  assert.equal(room.player(thief).stealing, null);
  begin();
  const pad = garagePoint(
    room.garage(owner).slot,
    FUEL.closeAcross,
    FUEL.closeOutward,
  );
  room.move(owner, pad);
  assert.equal(room.player(thief).stealing, null);
  const until = room.garage(owner).closedUntil;
  room.hold(owner, 31000);
  assert.equal(room.garage(owner).closedUntil, until);
  assert.ok(until < room.game.snapshotFuel().serverNow);
  assert.equal(room.player(thief).carrying, null);
});

test("stepping back onto the close pad cannot renew an active countdown, and expiry requires a fresh press", (t) => {
  const room = fixture(t);
  const owner = room.attach();
  const visitor = room.attach();
  const { slot } = room.garage(owner);
  const pad = garagePoint(slot, FUEL.closeAcross, FUEL.closeOutward);
  const away = garagePoint(slot, 0, 0);
  const outside = garagePoint(slot, 0, FUEL.gateOutward - 1);
  const inside = garagePoint(slot, 0, FUEL.gateOutward + 1);
  const doorEvents = () =>
    room.events.filter(
      (event) => event.type === "fuel:event" && event.kind === "door",
    );

  room.move(owner, pad);
  const closedAt = room.game.snapshotFuel().serverNow;
  const originalExpiry = closedAt + FUEL.gateMs;
  assert.equal(room.garage(owner).closedUntil, originalExpiry);
  assert.equal(doorEvents().length, 1);

  for (const elapsed of [5000, 29000]) {
    room.move(owner, away);
    room.advance(closedAt + elapsed - room.game.snapshotFuel().serverNow);
    room.move(owner, pad, false, 0);
    assert.equal(room.garage(owner).closedUntil, originalExpiry);
    assert.equal(doorEvents().length, 1);
    assert.ok(room.game.fuelDoorContact(outside, inside, visitor.player.id));
  }

  room.advance(originalExpiry - room.game.snapshotFuel().serverNow);
  room.move(owner, owner.player, false, 0);
  assert.equal(room.garage(owner).closedUntil, originalExpiry);
  assert.equal(doorEvents().length, 1);
  assert.equal(
    room.game.fuelDoorContact(outside, inside, visitor.player.id),
    null,
  );

  room.move(owner, away);
  room.move(owner, pad);
  assert.equal(
    room.garage(owner).closedUntil,
    room.game.snapshotFuel().serverNow + FUEL.gateMs,
  );
  assert.equal(doorEvents().length, 2);
  assert.ok(room.game.fuelDoorContact(outside, inside, visitor.player.id));
});

test("car impacts drop escrow and source owners recover it without increasing total fuel", (t) => {
  const room = fixture(t);
  const owner = room.attach();
  const thief = room.attach();
  room.advance(120000);
  room.steal(thief, owner);
  room.game.dropFuel([thief.player.id, owner.player.id]);
  assert.equal(room.player(thief).carrying, null);
  const drop = room.game.snapshotFuel().drops[0];
  assert.equal(drop.amount, 25);
  room.move(thief, { x: 0, z: 0 });
  room.move(owner, { x: drop.x, z: drop.z });
  room.hold(owner, 800);
  assert.equal(room.game.snapshotFuel().drops.length, 0);
  assert.equal(room.garage(owner).stored, 40);
  assert.equal(room.player(owner).carrying, null);
});

test("two completed holds share only the available stock, with one cargo each and replay-safe cancellation", (t) => {
  const room = fixture(t);
  const owner = room.attach();
  const a = room.attach();
  const b = room.attach();
  room.advance(120000);
  for (const user of [a, b]) {
    room.move(user, room.pump(owner));
    room.move(user);
  }
  assert.equal(
    room.action(a, "fuel:steal", { targetId: owner.player.id }, "a-hold").ok,
    true,
  );
  assert.equal(
    room.action(b, "fuel:steal", { targetId: owner.player.id }, "b-hold").ok,
    true,
  );
  for (let i = 0; i < 32; i += 1) {
    room.move(a);
    room.move(b, b.player, false, 0);
  }
  assert.equal(room.garage(owner).stored, 0);
  assert.equal(
    room.player(a).carrying.amount + room.player(b).carrying.amount,
    40,
  );
  assert.equal(
    room.action(a, "fuel:steal", { targetId: owner.player.id }, "a-hold").ok,
    true,
  );
  assert.equal(room.player(a).stealing, null);
  room.game.returnFuel(a.player.id);
  room.game.returnFuel(b.player.id);
  assert.equal(room.garage(owner).stored, 40);
  room.move(a);
  room.move(a);
  assert.equal(
    room.action(a, "fuel:steal", { targetId: owner.player.id }).ok,
    true,
  );
  for (let i = 0; i < 12; i += 1) room.action(a, "crate");
  assert.equal(room.action(a, "fuel:cancel").ok, true);
  assert.equal(room.player(a).stealing, null);
  room.hold(a);
  assert.equal(room.player(a).carrying, null);
});

test("impacts cancel an unfinished hold and source disconnects refund carried and dropped escrow", (t) => {
  const room = fixture(t);
  const owner = room.attach();
  const a = room.attach();
  const b = room.attach();
  room.advance(120000);
  room.move(a, room.pump(owner));
  room.move(a);
  assert.equal(
    room.action(a, "fuel:steal", { targetId: owner.player.id }).ok,
    true,
  );
  room.hold(a, 1000);
  room.game.dropFuel([a.player.id]);
  room.hold(a);
  assert.equal(room.player(a).carrying, null);
  room.steal(a, owner);
  room.steal(b, owner);
  room.game.dropFuel([b.player.id]);
  room.game.detach(owner.player.id);
  assert.equal(room.game.snapshotFuel().drops.length, 0);
  assert.equal(room.player(a).carrying, null);
  assert.equal(room.player(b).carrying, null);
  const back = room.attach(owner.resumeToken);
  assert.equal(room.garage(back).stored, 40);
});

test("disconnects and game entry return undelivered cargo; members cannot steal during a match", (t) => {
  const room = fixture(t);
  const owner = room.attach();
  const thief = room.attach();
  room.advance(120000);
  room.steal(thief, owner);
  room.game.detach(thief.player.id);
  assert.equal(room.garage(owner).stored, 40);
  const back = room.attach(thief.resumeToken);
  room.steal(back, owner);
  const match = room.action(back, "soccer:create");
  assert.equal(match.ok, true);
  assert.equal(room.player(back).carrying, null);
  assert.equal(room.garage(owner).stored, 40);
  assert.equal(
    room.action(back, "fuel:steal", { targetId: owner.player.id }).code,
    "fuel_out_of_range",
  );
  assert.equal(room.game.profile(back.player.id).coins, 0);
});

test("persisted escrow recovers once on restart and overflow refunds remain available without exceeding stock cap", (t) => {
  const room = fixture(t);
  const owner = room.attach();
  const thief = room.attach();
  room.sql((db) => {
    const accounts = db.prepare("SELECT id FROM accounts ORDER BY rowid").all();
    db.prepare(
      "UPDATE fuel_accounts SET tank = 20, stored = 200 WHERE account_id = ?",
    ).run(accounts[0].id);
    db.prepare("INSERT INTO fuel_cargo VALUES (?, ?, ?, 25, 0, 0, 0)").run(
      "interrupted-cargo",
      accounts[0].id,
      accounts[1].id,
    );
  });
  const back = room.attach(owner.resumeToken);
  assert.equal(room.game.snapshotFuel().drops.length, 0);
  assert.equal(room.garage(back).stored, 200);
  room.move(back, room.pump(back));
  room.hold(back, 1000);
  room.game.shutdown();
  room.sql((db) => {
    const row = db
      .prepare("SELECT * FROM fuel_accounts WHERE tank < 100")
      .get();
    assert.ok(
      Math.abs(row.tank + row.stored + row.refund_reserve - 245) < 1e-8,
    );
    assert.ok(row.stored <= 200);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM fuel_cargo").get().count,
      0,
    );
  });
});

test("failed escrow insertion rolls back theft and forged quantities never change balances", (t) => {
  const room = fixture(t);
  const owner = room.attach();
  const thief = room.attach();
  room.sql((db) =>
    db.exec(
      "CREATE TRIGGER no_cargo BEFORE INSERT ON fuel_cargo BEGIN SELECT RAISE(ABORT, 'disk failure'); END;",
    ),
  );
  const source = room.attach(owner.resumeToken);
  const taker = room.attach(thief.resumeToken);
  room.advance(120000);
  for (const extra of [
    { amount: 999 },
    { tank: 100 },
    { startedAt: 0 },
    { sourceAccount: "fake" },
  ])
    assert.equal(
      room.action(taker, "fuel:steal", { targetId: source.player.id, ...extra })
        .code,
      "invalid_game",
    );
  room.move(taker, room.pump(source));
  room.move(taker);
  assert.equal(
    room.action(taker, "fuel:steal", { targetId: source.player.id }).ok,
    true,
  );
  assert.throws(() => room.hold(taker), /disk failure/);
  assert.equal(room.garage(source).stored, 40);
  assert.equal(room.player(taker).carrying, null);
});
