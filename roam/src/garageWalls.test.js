import test from "node:test";
import assert from "node:assert/strict";
import {
  FUEL,
  garagePoint,
  garageSlot,
  garageWallContact,
  garageWallSegments,
  isGarageDriveable,
} from "./fuelConfig.js";
import { projectDuel, DUEL_TRACK, TRACK, trackPoint } from "./gameConfig.js";
import { findWorldPath } from "./railNavigation.js";

const at = (slot, across, outward, y = 0) => ({
  ...garagePoint(slot, across, outward),
  y,
});

test("1.5x garages have room for ten distinct platforms clear of the outer race", () => {
  assert.ok(Math.abs(FUEL.padRadius - 2.7 * 1.5) < 1e-9);
  for (let slot = 0; slot < FUEL.slots; slot++) {
    const center = garageSlot(slot);
    for (let other = slot + 1; other < FUEL.slots; other++) {
      const next = garageSlot(other);
      assert.ok(
        Math.hypot(center.x - next.x, center.z - next.z) >
          FUEL.padRadius * 2 + 0.3,
      );
    }
    for (let i = 0; i < 360; i++) {
      const angle = (i * Math.PI) / 180;
      const edge = at(
        slot,
        Math.sin(angle) * FUEL.padRadius,
        Math.cos(angle) * FUEL.padRadius,
      );
      assert.ok(
        projectDuel(edge.x, edge.z).distance > DUEL_TRACK.halfWidth + 0.35 + 2,
        "garage decks have a visible gap from the full race foundation",
      );
      // Project wall tops onto the ground along the default camera (24, 29, 32).
      // Flat footprints alone miss tall walls visibly covering the road behind them.
      const topX = edge.x - (FUEL.wallHeight * 24) / 29;
      const topZ = edge.z - (FUEL.wallHeight * 32) / 29;
      assert.ok(
        projectDuel(topX, topZ).distance > DUEL_TRACK.halfWidth + 0.35 + 1,
        "garage wall tops stay visually separate from the racing road",
      );
    }
  }
});

test("garage clearance does not crowd the coin loop at the opposite end of the course", () => {
  for (let index = 0; index < 1024; index++) {
    const point = trackPoint(index / 1024);
    assert.ok(
      projectDuel(point.x, point.z).distance >
        TRACK.halfWidth + DUEL_TRACK.halfWidth + 0.35 + 3,
    );
  }
});

test("back and side walls stop cars before leaving the deck at every garage rotation", () => {
  for (let slot = 0; slot < FUEL.slots; slot++) {
    const garage = { slot, ownerId: "owner", closedUntil: 0 };
    for (const [across, outward] of [
      [0, 10],
      [10, 0],
      [-10, 0],
    ]) {
      const from = at(slot, 0, 0),
        to = at(slot, across, outward);
      const contact = garageWallContact(from, to, garage);
      assert.ok(contact);
      assert.ok(contact.t > 0 && contact.t < 1);
      assert.ok(isGarageDriveable(contact.x, contact.z, slot));
      assert.ok(Math.abs(Math.hypot(contact.nx, contact.nz) - 1) < 1e-8);
      assert.equal(garageWallContact(from, contact, garage), null);
      const airborne = garageWallContact(
        { ...from, y: 8 },
        { ...to, y: 8 },
        garage,
      );
      assert.deepEqual(
        airborne,
        contact,
        "jumping never bypasses the safety wall",
      );
    }
  }
});

test("open entrances remain driveable both ways while bridge sides stop lateral impacts", () => {
  for (let slot = 0; slot < FUEL.slots; slot++) {
    const garage = { slot };
    const entry = at(slot, 0, FUEL.bridgeStart - FUEL.radius - 0.5);
    const inner = at(slot, 0, -1);
    assert.equal(garageWallContact(entry, inner, garage), null);
    assert.equal(garageWallContact(inner, entry, garage), null);
    for (const side of [-1, 1]) {
      const contact = garageWallContact(
        at(slot, 0, -3.9),
        at(slot, side * 5, -3.9),
        garage,
      );
      assert.ok(contact);
      assert.ok(isGarageDriveable(contact.x, contact.z, slot));
    }
  }
});

test("swept contacts reject wall shortcuts even when both endpoints are on valid floor", () => {
  const garage = { slot: 0 };
  const from = at(0, 1.7, -4.25),
    to = at(0, 3.1, -1.3);
  assert.ok(isGarageDriveable(from.x, from.z, 0));
  assert.ok(isGarageDriveable(to.x, to.z, 0));
  assert.ok(garageWallContact(from, to, garage));
  assert.ok(garageWallContact(to, from, garage));
});

test("routes to and between expanded garages stay clear of every physical wall", () => {
  const garages = Array.from({ length: FUEL.slots }, (_, slot) => ({
    slot,
    ownerId: `p${slot}`,
    closedUntil: 0,
  }));
  const origins = [{ x: 1.3, z: 7.8 }, at(0, 0, -1), at(9, 0, -1)];
  for (const start of origins)
    for (const garage of garages) {
      const target = at(garage.slot, 0, -0.95);
      if (Math.hypot(start.x - target.x, start.z - target.z) < 0.1) continue;
      const path = findWorldPath(start, target, [], {
        garages,
        playerId: garage.ownerId,
        now: 0,
      });
      assert.ok(path.length);
      let previous = start;
      for (const next of path) {
        for (const other of garages)
          assert.equal(garageWallContact(previous, next, other), null);
        previous = next;
      }
    }
  assert.equal(garageWallSegments(0).length, 66);
});
