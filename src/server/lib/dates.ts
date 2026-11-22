// Scheduling is day-granular, in the learner's own timezone (BACKEND.md).
// Dates are `YYYY-MM-DD` strings, which compare correctly as strings.

/** Today's date in `timeZone`, as `YYYY-MM-DD`. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** `date` plus `days`, as `YYYY-MM-DD`. Calendar arithmetic, no timezone. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
  return utc.toISOString().slice(0, 10);
}
