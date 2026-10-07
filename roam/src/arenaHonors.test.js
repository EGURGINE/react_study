import test from "node:test";
import assert from "node:assert/strict";
import { normalizeArenaHonors } from "./arenaHonors.js";

const victory = (arenaId = "arena-1") => ({
  arenaId,
  nickname: "아지트 친구",
  wonAt: 1791331200000,
  players: 4,
  pot: 80,
});

test("honors expose public winner fields while preserving separate equal-name leaders", () => {
  const data = normalizeArenaHonors({
    latest: { ...victory(), accountId: "private", resumeToken: "secret" },
    leaders: [
      {
        nickname: "같은 이름",
        wins: 7,
        lastWonAt: 1791331200000,
        accountId: "first",
      },
      {
        nickname: "같은 이름",
        wins: 2,
        lastWonAt: 1791331200001,
        accountId: "second",
      },
    ],
    recent: [{ ...victory(), playerId: "private" }],
    total: 9,
    internal: "private",
  });
  assert.deepEqual(data.latest, victory());
  assert.deepEqual(data.recent, [victory()]);
  assert.equal(data.leaders.length, 2);
  assert.deepEqual(
    data.leaders.map((leader) => leader.wins),
    [7, 2],
  );
  assert.doesNotMatch(
    JSON.stringify(data),
    /accountId|resumeToken|playerId|private|secret/,
  );
});

test("honors keep payloads bounded and remove duplicate or invalid victory records", () => {
  const data = normalizeArenaHonors({
    latest: { ...victory(), wonAt: Infinity },
    leaders: Array.from({ length: 70 }, (_, index) => ({
      nickname: `친구${index}`,
      wins: 70 - index,
      lastWonAt: 1,
    })),
    recent: [
      victory(),
      victory(),
      { ...victory("bad-date"), wonAt: 8.65e15 },
      { ...victory("bad-pot"), pot: -1 },
      ...Array.from({ length: 30 }, (_, index) => victory(`extra-${index}`)),
    ],
    total: 100,
  });
  assert.equal(data.latest, null);
  assert.equal(data.leaders.length, 50);
  assert.ok(data.recent.length <= 20);
  assert.equal(
    data.recent.filter((winner) => winner.arenaId === "arena-1").length,
    1,
  );
  assert.ok(
    data.recent.every(
      (winner) =>
        Number.isFinite(new Date(winner.wonAt).getTime()) && winner.pot >= 0,
    ),
  );
});

test("valid empty records remain distinct from unavailable or malformed data", () => {
  const empty = { latest: null, leaders: [], recent: [], total: 0 };
  assert.deepEqual(normalizeArenaHonors(empty), empty);
  for (const value of [
    null,
    {},
    { ...empty, total: -1 },
    { ...empty, total: 1.5 },
    { ...empty, leaders: null },
    { ...empty, recent: {} },
  ]) {
    assert.throws(() => normalizeArenaHonors(value), /Invalid arena honors/);
  }
});
