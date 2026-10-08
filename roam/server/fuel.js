import { randomUUID } from "node:crypto";
import {
  FUEL,
  garagePoint,
  garageLocal,
  isGarageDriveable,
  garageDoorContact,
  garageWallContact,
  getFuelEconomy,
} from "../src/fuelConfig.js";
import { getVehicleProfile } from "../src/vehicleDynamics.js";

export function createFuelController({
  db,
  peers,
  transaction,
  broadcast,
  teleport,
  now,
  fail,
  inGame,
}) {
  db.exec(`CREATE TABLE IF NOT EXISTS fuel_accounts (
    account_id TEXT PRIMARY KEY REFERENCES accounts(id),
    tank REAL NOT NULL DEFAULT 100 CHECK(tank BETWEEN 0 AND 100),
    stored REAL NOT NULL DEFAULT 0 CHECK(stored BETWEEN 0 AND 200),
    refund_reserve REAL NOT NULL DEFAULT 0 CHECK(refund_reserve >= 0),
    production_tick INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS fuel_cargo (
    id TEXT PRIMARY KEY, source_account TEXT NOT NULL REFERENCES accounts(id),
    carrier_account TEXT REFERENCES accounts(id), amount REAL NOT NULL CHECK(amount > 0),
    x REAL NOT NULL, z REAL NOT NULL, available_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS fuel_one_cargo ON fuel_cargo(carrier_account) WHERE carrier_account IS NOT NULL;`);
  const read = db.prepare("SELECT * FROM fuel_accounts WHERE account_id = ?");
  const cargoRows = db.prepare("SELECT * FROM fuel_cargo");
  const members = new Map();
  let lastBroadcast = -Infinity;
  let lastFlush = now();
  const rowFor = (id) => members.get(id);
  const cargoFor = (accountId) =>
    db
      .prepare("SELECT * FROM fuel_cargo WHERE carrier_account = ?")
      .get(accountId);
  const sourcePlayer = (accountId) =>
    [...members.values()].find((member) => member.accountId === accountId)
      ?.id || null;
  const rounded = (value) => Math.round(value * 100) / 100;
  function refund(cargo) {
    const source = read.get(cargo.source_account);
    const fit = Math.min(cargo.amount, FUEL.stockCapacity - source.stored);
    db.prepare(
      "UPDATE fuel_accounts SET stored = stored + ?, refund_reserve = refund_reserve + ? WHERE account_id = ?",
    ).run(fit, cargo.amount - fit, cargo.source_account);
    db.prepare("DELETE FROM fuel_cargo WHERE id = ?").run(cargo.id);
  }
  // Undelivered cargo survives a crash; return it once in the recovery commit.
  // Overflow refunds remain reserved rather than disappearing at the stock cap.
  transaction(() => {
    for (const cargo of cargoRows.all()) refund(cargo);
  });
  const event = (id, kind, message) =>
    broadcast({ type: "fuel:event", playerId: id, kind, message });
  function snapshot() {
    const time = now();
    const cargo = cargoRows.all();
    return {
      serverNow: time,
      serverAt: time,
      nextProductionAt:
        (Math.floor(time / FUEL.productionIntervalMs) + 1) *
        FUEL.productionIntervalMs,
      productionPerMinute: FUEL.production,
      garages: [...members.values()].map((member) => {
        const peer = peers.get(member.id);
        return {
          ownerId: member.id,
          nickname: peer.player.nickname,
          color: peer.player.color,
          slot: member.slot,
          stored: rounded(read.get(member.accountId).stored),
          closedUntil: member.closedUntil,
        };
      }),
      players: [...members.values()].map((member) => {
        const carried = cargo.find(
          (item) => item.carrier_account === member.accountId,
        );
        const economy = getFuelEconomy(
          peers.get(member.id).player.cosmetics.body,
        );
        return {
          id: member.id,
          tank: rounded(member.tank),
          consumptionRate: economy.consumptionRate,
          boostSeconds: member.tank / economy.consumptionRate,
          carrying: carried
            ? {
                id: carried.id,
                amount: rounded(carried.amount),
                sourceOwnerId: sourcePlayer(carried.source_account),
              }
            : null,
          stealing: member.stealing ? { ...member.stealing } : null,
        };
      }),
      drops: cargo
        .filter((item) => !item.carrier_account)
        .map((item) => ({
          id: item.id,
          x: item.x,
          z: item.z,
          amount: rounded(item.amount),
          sourceOwnerId: sourcePlayer(item.source_account),
        })),
    };
  }
  function publish() {
    lastBroadcast = now();
    broadcast({ type: "fuel:state", fuel: snapshot() });
  }
  function attach(id) {
    const peer = peers.get(id);
    const time = now();
    const currentTick = Math.floor(time / FUEL.productionIntervalMs);
    db.prepare(
      "INSERT OR IGNORE INTO fuel_accounts(account_id, production_tick) VALUES (?, ?)",
    ).run(peer.accountId, currentTick);
    const row = read.get(peer.accountId);
    const taken = new Set([...members.values()].map((member) => member.slot));
    const slot = Array.from({ length: FUEL.slots }, (_, index) => index).find(
      (index) => !taken.has(index),
    );
    if (slot === undefined) return;
    members.set(id, {
      id,
      accountId: peer.accountId,
      slot,
      tank: row.tank,
      productionTick: Math.max(currentTick, row.production_tick),
      closedUntil: 0,
      atPad: false,
      previous: { ...peer.player },
      lastMotionAt: time,
      speed: 0,
      pumpAt: null,
      stealing: null,
    });
    publish();
  }
  function flush() {
    transaction(() => {
      for (const member of members.values())
        db.prepare(
          "UPDATE fuel_accounts SET tank = ? WHERE account_id = ?",
        ).run(member.tank, member.accountId);
    });
    lastFlush = now();
  }
  function cancel(id, announce = false) {
    const member = rowFor(id);
    if (!member?.stealing) return;
    member.stealing = null;
    if (announce) event(id, "cancel", "연료를 가져오던 작업이 중단됐어요.");
  }
  function returnCargo(id, announce = true) {
    const member = rowFor(id);
    if (!member) return;
    cancel(id);
    const cargo = cargoFor(member.accountId);
    if (cargo) {
      transaction(() => refund(cargo));
      if (announce)
        event(id, "return", "운반 중인 연료를 원래 차고에 돌려놓았어요.");
    }
    publish();
  }
  function detach(id) {
    const member = rowFor(id);
    if (!member) return;
    transaction(() => {
      db.prepare("UPDATE fuel_accounts SET tank = ? WHERE account_id = ?").run(
        member.tank,
        member.accountId,
      );
      for (const cargo of cargoRows.all())
        if (
          cargo.carrier_account === member.accountId ||
          cargo.source_account === member.accountId
        )
          refund(cargo);
    });
    members.delete(id);
    for (const other of members.values()) {
      if (other.stealing?.targetId === id) cancel(other.id, true);
      const pose = peers.get(other.id).player;
      if (!inGame(other.id) && isGarageDriveable(pose.x, pose.z, member.slot)) {
        const safe = {
          ...garagePoint(member.slot, 0, FUEL.bridgeStart - FUEL.radius),
          y: 0,
          heading: pose.heading,
        };
        Object.assign(pose, safe);
        reposition(other.id, safe);
        teleport(other.id, safe);
      }
    }
    publish();
  }
  function reposition(id, pose) {
    const member = rowFor(id);
    if (!member) return;
    member.previous = { ...pose };
    member.speed = 0;
    member.lastMotionAt = now();
    member.pumpAt = null;
    cancel(id);
  }
  function validTheft(member, target, time) {
    if (
      !target ||
      member.id === target.id ||
      inGame(member.id) ||
      target.closedUntil > time ||
      member.speed > 1.5 ||
      time - member.lastMotionAt > 500 ||
      cargoFor(member.accountId)
    )
      return false;
    const pose = peers.get(member.id)?.player;
    const pump = garagePoint(target.slot, FUEL.pumpAcross, FUEL.pumpOutward);
    return (
      pose &&
      (pose.y || 0) < 0.6 &&
      Math.hypot(pose.x - pump.x, pose.z - pump.z) <= FUEL.proximity
    );
  }
  function plan(id, data, time) {
    const member = rowFor(id);
    if (!member)
      fail("온라인으로 입장한 뒤 사용할 수 있어요.", "fuel_unavailable");
    if (data.action === "fuel:cancel")
      return {
        details: {},
        effect: () => {
          cancel(id);
          publish();
        },
      };
    if (data.action !== "fuel:steal")
      fail("지원하지 않는 연료 요청이에요.", "invalid_game");
    const target = rowFor(data.targetId);
    if (!validTheft(member, target, time))
      fail(
        "열린 다른 차고의 연료통 가까이에서 멈춰 주세요.",
        "fuel_out_of_range",
      );
    if (read.get(target.accountId).stored <= 0)
      fail("이 차고에 남은 연료가 없어요.", "fuel_empty");
    if (member.stealing) return { details: {}, effect: () => {} };
    return {
      details: {},
      effect: () => {
        member.stealing = {
          targetId: target.id,
          startedAt: time,
          endsAt: time + FUEL.stealMs,
        };
        publish();
      },
    };
  }
  function observe(id, pose, manualBoost, elapsed) {
    const member = rowFor(id);
    if (!member) return;
    const time = now();
    const distance = Math.hypot(
      pose.x - member.previous.x,
      pose.z - member.previous.z,
    );
    member.speed = elapsed > 0 && elapsed <= 0.5 ? distance / elapsed : 0;
    member.lastMotionAt = time;
    member.previous = { ...pose };
    if (manualBoost && distance > 0.025) {
      const rate = getFuelEconomy(
        peers.get(id).player.cosmetics.body,
      ).consumptionRate;
      const boostSpeed = getVehicleProfile(
        peers.get(id).player.cosmetics.body,
      ).boostSpeed;
      // Accepted delayed/batched travel still has a fuel cost. A stale packet
      // never charges the entire idle interval, and replayed stationary input
      // cannot consume fuel. Distance also accounts for queued 80 ms packets
      // delivered together with almost zero server time between them.
      const duration = Math.max(
        Math.min(0.25, Math.max(0, elapsed)),
        distance / boostSpeed,
      );
      member.tank = Math.max(0, member.tank - rate * duration);
    }
    if (inGame(id)) {
      cancel(id);
      return;
    }
    const local = garageLocal(member.slot, pose.x, pose.z);
    const onPad =
      Math.hypot(
        local.across - FUEL.closeAcross,
        local.outward - FUEL.closeOutward,
      ) <= FUEL.closeRadius;
    if (
      onPad &&
      !member.atPad &&
      member.closedUntil <= time &&
      distance > 0.025 &&
      (pose.y || 0) < 0.6
    ) {
      member.closedUntil = time + FUEL.gateMs;
      for (const other of members.values())
        if (other.stealing?.targetId === id) cancel(other.id, true);
      event(id, "door", "내 차고 문을 30초 동안 닫았어요.");
      publish();
    }
    member.atPad = onPad;
    if (
      member.stealing &&
      !validTheft(member, rowFor(member.stealing.targetId), time)
    )
      cancel(id, true);
  }
  function impact(ids) {
    const time = now();
    let changed = false;
    transaction(() => {
      for (const id of ids) {
        const member = rowFor(id);
        if (!member) continue;
        changed ||= Boolean(member.stealing);
        cancel(id, true);
        const cargo = cargoFor(member.accountId);
        if (!cargo) continue;
        const pose = peers.get(id).player;
        db.prepare(
          "UPDATE fuel_cargo SET carrier_account = NULL, x = ?, z = ?, available_at = ? WHERE id = ?",
        ).run(pose.x, pose.z, time + 700, cargo.id);
        changed = true;
      }
    });
    if (changed) publish();
  }
  function tick() {
    const time = now();
    const epochTick = Math.floor(time / FUEL.productionIntervalMs);
    for (const member of members.values()) {
      if (epochTick > member.productionTick) {
        const count = epochTick - member.productionTick;
        transaction(() => {
          const row = read.get(member.accountId);
          const refundUnits = Math.min(
            row.refund_reserve,
            FUEL.stockCapacity - row.stored,
          );
          db.prepare(
            "UPDATE fuel_accounts SET stored = MIN(200, stored + ?), refund_reserve = refund_reserve - ?, production_tick = ? WHERE account_id = ?",
          ).run(
            refundUnits + FUEL.production * count,
            refundUnits,
            epochTick,
            member.accountId,
          );
        });
        member.productionTick = epochTick;
      }
      if (inGame(member.id)) {
        if (member.stealing || cargoFor(member.accountId))
          returnCargo(member.id);
        member.pumpAt = null;
        continue;
      }
      if (member.stealing) {
        const target = rowFor(member.stealing.targetId);
        if (!validTheft(member, target, time)) cancel(member.id, true);
        else if (time >= member.stealing.endsAt) {
          let amount = 0;
          transaction(() => {
            amount = Math.min(
              FUEL.stealAmount,
              read.get(target.accountId).stored,
            );
            if (!amount) return;
            db.prepare(
              "UPDATE fuel_accounts SET stored = stored - ? WHERE account_id = ?",
            ).run(amount, target.accountId);
            const pose = peers.get(member.id).player;
            db.prepare(
              "INSERT INTO fuel_cargo VALUES (?, ?, ?, ?, ?, ?, ?)",
            ).run(
              randomUUID(),
              target.accountId,
              member.accountId,
              amount,
              pose.x,
              pose.z,
              time,
            );
          });
          member.stealing = null;
          if (amount)
            event(
              member.id,
              "stolen",
              `연료 ${rounded(amount)}을 실었어요. 내 차고로 가져가세요.`,
            );
        }
      }
      const pose = peers.get(member.id).player;
      for (const drop of cargoRows
        .all()
        .filter((item) => !item.carrier_account)) {
        if (
          time < drop.available_at ||
          Math.hypot(pose.x - drop.x, pose.z - drop.z) > 1.1 ||
          (pose.y || 0) > 0.6
        )
          continue;
        if (drop.source_account === member.accountId) {
          transaction(() => refund(drop));
          event(
            member.id,
            "recovered",
            "떨어진 내 연료를 창고로 돌려놓았어요.",
          );
        } else if (!cargoFor(member.accountId)) {
          db.prepare(
            "UPDATE fuel_cargo SET carrier_account = ? WHERE id = ? AND carrier_account IS NULL",
          ).run(member.accountId, drop.id);
          event(
            member.id,
            "pickup",
            "떨어진 연료를 실었어요. 내 차고로 가져가세요.",
          );
        }
      }
      const pump = garagePoint(member.slot, FUEL.pumpAcross, FUEL.pumpOutward);
      if (
        Math.hypot(pose.x - pump.x, pose.z - pump.z) > FUEL.proximity ||
        (pose.y || 0) > 0.6
      ) {
        member.pumpAt = null;
        continue;
      }
      const carried = cargoFor(member.accountId);
      if (carried) {
        const fit = Math.min(
          carried.amount,
          FUEL.stockCapacity - read.get(member.accountId).stored,
        );
        if (fit > 0)
          transaction(() => {
            db.prepare(
              "UPDATE fuel_accounts SET stored = stored + ? WHERE account_id = ?",
            ).run(fit, member.accountId);
            if (fit >= carried.amount - 1e-8)
              db.prepare("DELETE FROM fuel_cargo WHERE id = ?").run(carried.id);
            else
              db.prepare(
                "UPDATE fuel_cargo SET amount = amount - ? WHERE id = ?",
              ).run(fit, carried.id);
          });
        if (fit >= carried.amount - 1e-8)
          event(member.id, "delivered", "운반한 연료를 내 차고에 보관했어요.");
      }
      if (member.speed > 1.5 || time - member.lastMotionAt > 500) {
        member.pumpAt = null;
        continue;
      }
      if (member.pumpAt === null) member.pumpAt = time;
      if (time - member.pumpAt < 250) continue;
      let row = read.get(member.accountId);
      if (row.refund_reserve > 0 && row.stored < FUEL.stockCapacity) {
        const returned = Math.min(
          row.refund_reserve,
          FUEL.stockCapacity - row.stored,
        );
        db.prepare(
          "UPDATE fuel_accounts SET stored = stored + ?, refund_reserve = refund_reserve - ? WHERE account_id = ?",
        ).run(returned, returned, member.accountId);
        row = read.get(member.accountId);
      }
      const amount = Math.min(
        FUEL.capacity - member.tank,
        row.stored,
        FUEL.transferPerSecond * Math.min(0.5, (time - member.pumpAt) / 1000),
      );
      member.pumpAt = time;
      if (amount > 0) {
        transaction(() => {
          db.prepare(
            "UPDATE fuel_accounts SET tank = ?, stored = stored - ? WHERE account_id = ?",
          ).run(member.tank + amount, amount, member.accountId);
        });
        member.tank += amount;
      }
    }
    if (time - lastFlush >= 1000) flush();
    if (members.size && time - lastBroadcast >= 250) publish();
  }
  return {
    attach,
    detach,
    snapshot,
    tick,
    plan,
    observe,
    impact,
    returnCargo,
    reposition,
    tank: (id) => rowFor(id)?.tank ?? 0,
    driveable: (x, z) =>
      [...members.values()].some((member) =>
        isGarageDriveable(x, z, member.slot),
      ),
    doorContact: (previous, next, id) => {
      for (const member of members.values()) {
        // Solid sides/back belong to the platform, not its owner. Test the
        // entire movement segment even when both endpoints are valid ground;
        // jumping never grants passage through these safety walls.
        const wall = garageWallContact(previous, next, member);
        if (wall) return wall;
        const contact = garageDoorContact(
          previous,
          next,
          { ...member, ownerId: member.id },
          id,
          now(),
        );
        if (contact) return contact;
      }
      return null;
    },
    shutdown: () => {
      flush();
      transaction(() => {
        for (const cargo of cargoRows.all()) refund(cargo);
      });
      members.clear();
    },
  };
}
