// Imported by both the app and the server. Keep it free of runtime code
// that depends on either platform.
import type { Card } from "./cards.ts";

/** The single error envelope every API error uses. `code` is stable. */
export type ErrorBody = {
  error: { code: string; message: string; field?: string };
};

export type Me = {
  id: string;
  email: string;
  timezone: string;
  createdAt: number;
};

export type DumpStatus = "pending" | "extracting" | "awaiting_review" | "committed" | "failed";

export type DumpView = {
  id: string;
  kind: "image" | "audio" | "url" | "text";
  text: string;
  status: DumpStatus;
  /** Why it failed, in words the learner can act on. */
  error: string | null;
  createdAt: number;
  /** The word this dump put in the pool, when it put in exactly one. */
  word: { lemma: string; pos: string; translation: string; rung: number; usageNote: string | null } | null;
  /** How many words this dump put in the pool. */
  kept: number;
  /** The page a link dump came from. */
  source: string | null;
  /** Committed, but the word was already in the pool. */
  alreadyInPool: boolean;
  /** What extraction found: all of it, and how much is new to this learner. Null for a typed word. */
  found: { total: number; fresh: number } | null;
};

/** A word extraction found, waiting to be kept or dropped. */
export type CandidateView = {
  wordId: string;
  lemma: string;
  pos: string;
  gender: "m" | "f" | null;
  translation: string;
  usageNote: string | null;
  /** As it appeared in the source, for highlighting. */
  form: string | null;
  /** The sentence it was met in. */
  sentence: string | null;
  /** Already in this learner's pool: shown, but not ticked. */
  known: boolean;
};

/** GET /dumps/:id */
export type DumpDetail = DumpView & { candidates: CandidateView[] };

/** GET /sessions/today */
export type TodayView = {
  forDate: string;
  /** Cards today's session holds (or would hold, if not started yet). */
  total: number;
  answered: number;
  state: "nothing_due" | "ready" | "in_progress" | "completed";
};

export type SessionView = {
  id: string;
  forDate: string;
  cards: Card[];
  /** Cards already answered, so a reopened session resumes where it stopped. */
  answered: { wordId: string; correct: boolean }[];
  completed: boolean;
};

export type AnswerResult = {
  correct: boolean;
  /** The right answer: the word (recall), the meaning (recognition, comprehension). */
  expected: string;
  accentSlip: boolean;
  next: { rung: number; intervalDays: number; dueOn: string };
  /** Model-graded cards (rung 3 and up) only. */
  judged?: {
    /** Right idea, not quite there: passes, but the word stays on its rung. */
    close: boolean;
    errorKind: string | null;
    /** Why, when it wasn't right: the mechanism, in a sentence or two. */
    explanation: string | null;
  };
};
