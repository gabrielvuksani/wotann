/**
 * Cron schedule utilities.
 *
 * Extracted from `kairos.ts` (S0-14) to break a fragile circular value import
 * between `kairos.ts` and `event-triggers.ts`. The previous arrangement worked
 * only by function hoisting accident — one small refactor would have produced
 * a TDZ crash at startup.
 *
 * Both `kairos.ts` and `event-triggers.ts` now depend on this leaf module.
 */

/**
 * Parse a simple crontab field: number, *, or * /step.
 *
 * Supports:
 * - `*` — any value
 * - `N` — exact match
 * - `*\/N` — every N (step)
 * - `a,b,c` — enumerated values
 * - `a-b` — inclusive range
 */
export function matchCronField(field: string, value: number, max: number): boolean {
  if (field === "*") return true;
  if (value > max) return false;
  if (field.includes("/")) {
    const step = parseInt(field.split("/")[1] ?? "1", 10);
    return step > 0 && value % step === 0;
  }
  if (field.includes(",")) {
    return field.split(",").some((v) => parseInt(v, 10) === value);
  }
  if (field.includes("-")) {
    const [min, maxVal] = field.split("-").map((v) => parseInt(v, 10));
    return min !== undefined && maxVal !== undefined && value >= min && value <= maxVal;
  }
  return parseInt(field, 10) === value;
}

/**
 * Check if a cron schedule matches the current time.
 *
 * Format: "minute hour day-of-month month day-of-week"
 *
 * Example: `"0 9 * * 1"` = 09:00 UTC every Monday.
 *
 * Wave 3-Q: cron fields are evaluated against UTC, not local time, for
 * DST-safety. Local-time cron skips spring-forward (e.g. 02:30 never fires)
 * and double-fires fall-back (e.g. 01:30 fires twice). UTC has no DST so
 * a job scheduled at "30 2 * * *" reliably fires once per day at 02:30 UTC.
 */
export function matchesCronSchedule(schedule: string, now: Date): boolean {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length < 5) return false;

  // UTC for DST-safety per Wave 3-Q
  const minute = now.getUTCMinutes();
  const hour = now.getUTCHours();
  const dayOfMonth = now.getUTCDate();
  const month = now.getUTCMonth() + 1;
  const dayOfWeek = now.getUTCDay();

  return (
    matchCronField(parts[0]!, minute, 59) &&
    matchCronField(parts[1]!, hour, 23) &&
    matchCronField(parts[2]!, dayOfMonth, 31) &&
    matchCronField(parts[3]!, month, 12) &&
    matchCronField(parts[4]!, dayOfWeek, 6)
  );
}
