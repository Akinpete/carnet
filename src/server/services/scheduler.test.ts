import { describe, expect, it } from "vitest";
import { addDays, todayIn } from "../lib/dates.ts";
import {
  EASE_FLOOR,
  LEECH_AT,
  MAX_INTERVAL,
  NEW_WORD,
  schedule,
  type Grade,
  type Rung,
  type WordState,
} from "./scheduler.ts";

const run = (grades: Grade[], from: WordState = NEW_WORD, maxRung: Rung = 5) =>
  grades.reduce((s, g) => schedule(s, g, maxRung), from);

// The test table: (grade sequence from a new word) → expected state.
// Each row was worked through by hand from the rules in BACKEND.md.
const table: { name: string; grades: Grade[]; expect: Partial<WordState> }[] = [
  { name: "first pass", grades: [3], expect: { rung: 2, ease: 2.5, intervalDays: 1, reps: 1, lapses: 0 } },
  { name: "second pass", grades: [3, 3], expect: { rung: 3, intervalDays: 6, reps: 2 } },
  { name: "third pass multiplies by ease", grades: [3, 3, 3], expect: { rung: 4, intervalDays: 15, reps: 3 } },
  { name: "fourth pass", grades: [3, 3, 3, 3], expect: { rung: 5, intervalDays: 38, reps: 4 } },
  { name: "rung stops at 5", grades: [3, 3, 3, 3, 3], expect: { rung: 5, intervalDays: 95 } },
  { name: "fluent raises ease", grades: [4], expect: { ease: 2.6, rung: 2, intervalDays: 1 } },
  { name: "hard pass lowers ease, holds rung", grades: [2], expect: { ease: 2.35, rung: 1, intervalDays: 1, reps: 1 } },
  { name: "grade 0 on a new word", grades: [0], expect: { rung: 1, ease: 2.2, intervalDays: 1, reps: 0, lapses: 1 } },
  { name: "grade 0 drops a rung", grades: [3, 3, 0], expect: { rung: 2, intervalDays: 1, reps: 0, lapses: 1, ease: 2.2 } },
  { name: "grade 1 holds the rung", grades: [3, 3, 1], expect: { rung: 3, intervalDays: 1, reps: 0, lapses: 1 } },
  { name: "recovery after a lapse restarts the ladder of intervals", grades: [3, 3, 0, 3], expect: { rung: 3, intervalDays: 1, reps: 1 } },
  { name: "ease floors at 1.3", grades: [0, 0, 0, 0, 0, 0], expect: { ease: EASE_FLOOR, lapses: 6 } },
];

describe("schedule: the test table", () => {
  for (const row of table) {
    it(row.name, () => {
      const s = run(row.grades);
      for (const [key, value] of Object.entries(row.expect)) {
        if (key === "ease") expect(s.ease).toBeCloseTo(value as number, 10);
        else expect(s[key as keyof WordState]).toBe(value);
      }
    });
  }
});

describe("schedule: leeches", () => {
  it(`becomes a leech at ${LEECH_AT} lapses`, () => {
    expect(run([0, 0, 0, 0]).isLeech).toBe(false);
    expect(run([0, 0, 0, 0, 0]).isLeech).toBe(true);
  });

  it("clears after two consecutive passes, not one", () => {
    const leech = run([0, 0, 0, 0, 0]);
    expect(schedule(leech, 3).isLeech).toBe(true);
    expect(run([3, 3], leech).isLeech).toBe(false);
  });

  it("a pass, a fail, a pass doesn't clear it", () => {
    expect(run([3, 0, 3], run([0, 0, 0, 0, 0])).isLeech).toBe(true);
  });
});

describe("schedule: maxRung (only rungs 1–2 exist in M1)", () => {
  it("never climbs past maxRung", () => {
    expect(run([3, 3, 3, 3], NEW_WORD, 2).rung).toBe(2);
  });

  it("still schedules normally while capped", () => {
    expect(run([3, 3, 3], NEW_WORD, 2).intervalDays).toBe(15);
  });

  it("clamps a stored rung that is above the cap", () => {
    expect(schedule({ ...NEW_WORD, rung: 4 }, 3, 2).rung).toBe(2);
  });
});

describe("schedule: properties", () => {
  // Deterministic pseudo-random sequences, so failures reproduce.
  function* sequences(count: number, length: number) {
    let seed = 42;
    const next = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let i = 0; i < count; i++) yield Array.from({ length }, () => Math.floor(next() * 5) as Grade);
  }

  it("ease never drops below the floor, intervals never pass the cap, rung stays in 1..5", () => {
    for (const grades of sequences(500, 40)) {
      let s = NEW_WORD;
      for (const g of grades) {
        s = schedule(s, g);
        expect(s.ease).toBeGreaterThanOrEqual(EASE_FLOOR);
        expect(s.intervalDays).toBeGreaterThanOrEqual(1);
        expect(s.intervalDays).toBeLessThanOrEqual(MAX_INTERVAL);
        expect(s.rung).toBeGreaterThanOrEqual(1);
        expect(s.rung).toBeLessThanOrEqual(5);
      }
    }
  });

  it("a word that always passes reaches rung 5 and the interval cap", () => {
    const s = run(Array(30).fill(3));
    expect(s.rung).toBe(5);
    expect(s.intervalDays).toBe(MAX_INTERVAL);
  });

  it("a word that always fails stays at rung 1 with interval 1", () => {
    const s = run(Array(30).fill(0));
    expect(s.rung).toBe(1);
    expect(s.intervalDays).toBe(1);
    expect(s.isLeech).toBe(true);
  });
});

describe("dates", () => {
  it("adds days across month and year ends", () => {
    expect(addDays("2026-11-22", 1)).toBe("2026-11-23");
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-01-01", 180)).toBe("2026-06-30");
  });

  it("resolves today in the learner's timezone", () => {
    const lateUtc = new Date("2026-11-22T23:30:00Z");
    expect(todayIn("UTC", lateUtc)).toBe("2026-11-22");
    expect(todayIn("Africa/Lagos", lateUtc)).toBe("2026-11-23"); // UTC+1
    expect(todayIn("America/New_York", lateUtc)).toBe("2026-11-22");
  });
});
