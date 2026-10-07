import {
  attendanceCalendarDay,
  attendanceDayStartsAt,
  getAttendanceReward,
} from "../src/attendanceConfig.js";
import { DUPLICATE_REFUND, ITEMS } from "../src/gameConfig.js";

const VEHICLE_RARITIES = new Set(["epic", "legendary", "mythic"]);

/** The owning game engine commits claim, account reward and receipt together. */
export function createAttendanceController({ db, now, random, fail }) {
  db.exec(`CREATE TABLE IF NOT EXISTS attendance (
    account_id TEXT PRIMARY KEY REFERENCES accounts(id),
    claimed_days INTEGER NOT NULL CHECK (claimed_days > 0),
    last_day INTEGER NOT NULL,
    last_reward TEXT NOT NULL
  );`);
  const lookup = db.prepare("SELECT * FROM attendance WHERE account_id = ?");
  const account = db.prepare("SELECT inventory FROM accounts WHERE id = ?");
  const save = db.prepare(`INSERT INTO attendance
    (account_id, claimed_days, last_day, last_reward) VALUES (?, ?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET
      claimed_days = excluded.claimed_days,
      last_day = excluded.last_day,
      last_reward = excluded.last_reward`);
  const giveCoins = db.prepare(
    "UPDATE accounts SET coins = coins + ? WHERE id = ?",
  );
  const giveVehicle = db.prepare(
    "UPDATE accounts SET inventory = ? WHERE id = ?",
  );

  function status(accountId, time = now()) {
    const today = attendanceCalendarDay(time);
    const row = lookup.get(accountId);
    const claimedDays = row?.claimed_days ?? 0;
    // A server clock correction cannot reopen a previously rewarded date.
    const available = !row || today > row.last_day;
    const reward = getAttendanceReward(claimedDays + (available ? 1 : 0));
    return {
      claimedDays,
      day: reward.day,
      cycle: reward.cycle,
      claimedToday: row?.last_day === today,
      available,
      nextClaimAt: attendanceDayStartsAt(
        Math.max(today, row?.last_day ?? today) + 1,
      ),
      serverNow: time,
      reward,
      lastClaim: row ? JSON.parse(row.last_reward) : null,
    };
  }

  function claim(accountId, time) {
    const current = status(accountId, time);
    if (!current.available)
      fail(
        "오늘의 출석 보상은 이미 받았어요. 한국 시간 자정 이후 다시 만나요.",
        "attendance_claimed",
      );
    const reward = current.reward;
    const attendanceReward = {
      day: reward.day,
      cycle: reward.cycle,
      kind: reward.kind,
      claimedAt: time,
    };
    let details = {};
    if (reward.kind === "coins") {
      giveCoins.run(reward.coins, accountId);
      attendanceReward.coins = reward.coins;
    } else {
      const inventory = JSON.parse(account.get(accountId).inventory);
      const eligible = ITEMS.filter(
        (item) =>
          item.type === "body" &&
          !item.starter &&
          (reward.minRarity === "mythic"
            ? item.rarity === "mythic"
            : VEHICLE_RARITIES.has(item.rarity)),
      );
      const unowned = eligible.filter((item) => !inventory.includes(item.id));
      const pool = unowned.length ? unowned : eligible;
      const roll = random();
      if (!pool.length || !Number.isFinite(roll) || roll < 0 || roll >= 1)
        throw new RangeError("Invalid attendance vehicle draw");
      const item = pool[Math.floor(roll * pool.length)];
      const duplicate = inventory.includes(item.id);
      const refund = duplicate ? DUPLICATE_REFUND : 0;
      if (duplicate) giveCoins.run(refund, accountId);
      else giveVehicle.run(JSON.stringify([...inventory, item.id]), accountId);
      Object.assign(attendanceReward, { itemId: item.id, duplicate, refund });
      details = { item, duplicate, refund };
    }
    save.run(
      accountId,
      current.claimedDays + 1,
      attendanceCalendarDay(time),
      JSON.stringify(attendanceReward),
    );
    return { ...details, attendanceReward };
  }

  return { status, claim };
}
