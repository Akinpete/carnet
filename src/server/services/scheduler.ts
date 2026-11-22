// SM-2 with Carnet's deviations (BACKEND.md, Scheduler). A pure function of
// (state, grade): no I/O, no clock. A scheduling bug is invisible for weeks
// and then has corrupted months of intervals, so this is tested by table.
//
// SRS decides *when* a word comes back; the rung decides *what* it asks.

export type Rung = 1 | 2 | 3 | 4 | 5;
export type Grade = 0 | 1 | 2 | 3 | 4;

export type WordState = {
  rung: Rung;
  ease: number; // >= EASE_FLOOR
  intervalDays: number;
  reps: number; // consecutive passes since the last lapse
  lapses: number; // total failures, ever
  isLeech: boolean;
};

export const EASE_FLOOR = 1.3;
export const LAPSE_PENALTY = 0.3; // SM-2 uses 0.2; steeper on purpose
export const MAX_INTERVAL = 180;
export const LEECH_AT = 5;
/** A leech clears after this many consecutive passes. */
export const LEECH_CLEAR_AFTER = 2;

export const NEW_WORD: WordState = { rung: 1, ease: 2.5, intervalDays: 0, reps: 0, lapses: 0, isLeech: false };

const clampRung = (rung: number, maxRung: Rung): Rung => Math.min(Math.max(rung, 1), maxRung) as Rung;

/**
 * @param maxRung the highest rung with a card type built so far. Words don't
 *   climb past it, so the stored rung never claims a card that doesn't exist.
 */
export function schedule(s: WordState, grade: Grade, maxRung: Rung = 5): WordState {
  // Failure: grades 0 and 1. Grade 0 drops a rung so the next showing asks an
  // easier question; grade 1 (right idea, wrong form) holds it.
  if (grade <= 1) {
    const lapses = s.lapses + 1;
    return {
      rung: grade === 0 ? clampRung(s.rung - 1, maxRung) : clampRung(s.rung, maxRung),
      ease: Math.max(EASE_FLOOR, s.ease - LAPSE_PENALTY),
      intervalDays: 1,
      reps: 0,
      lapses,
      isLeech: lapses >= LEECH_AT,
    };
  }

  // Success: grades 2, 3, 4.
  const ease = Math.max(EASE_FLOOR, s.ease + (grade === 2 ? -0.15 : grade === 4 ? 0.1 : 0));
  const intervalDays =
    s.reps === 0 ? 1 : s.reps === 1 ? 6 : Math.min(MAX_INTERVAL, Math.round(s.intervalDays * ease));
  const reps = s.reps + 1;

  return {
    rung: grade >= 3 ? clampRung(s.rung + 1, maxRung) : clampRung(s.rung, maxRung),
    ease,
    intervalDays,
    reps,
    lapses: s.lapses,
    isLeech: s.isLeech && reps < LEECH_CLEAR_AFTER,
  };
}
