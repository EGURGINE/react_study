export const ATTENDANCE_CYCLE_DAYS = 7;
export const ATTENDANCE_DAY_MS = 24 * 60 * 60 * 1000;
export const ATTENDANCE_KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** Rewards follow claimed days, not consecutive calendar days. */
export function getAttendanceReward(lifetimeDay) {
  if (!Number.isSafeInteger(lifetimeDay) || lifetimeDay < 1)
    throw new RangeError("Attendance day must be a positive safe integer");
  const day = ((lifetimeDay - 1) % ATTENDANCE_CYCLE_DAYS) + 1;
  const cycle = Math.floor((lifetimeDay - 1) / ATTENDANCE_CYCLE_DAYS) + 1;
  if (lifetimeDay === 1)
    return { day, cycle, kind: "vehicle", minRarity: "mythic" };
  if (day === 7) return { day, cycle, kind: "vehicle", minRarity: "epic" };
  return { day, cycle, kind: "coins", coins: day * 100 };
}

export function attendanceCalendarDay(time) {
  if (!Number.isSafeInteger(time) || time < 0)
    throw new RangeError("Attendance time must be a nonnegative epoch value");
  return Math.floor((time + ATTENDANCE_KST_OFFSET_MS) / ATTENDANCE_DAY_MS);
}

export function attendanceDayStartsAt(day) {
  return day * ATTENDANCE_DAY_MS - ATTENDANCE_KST_OFFSET_MS;
}
