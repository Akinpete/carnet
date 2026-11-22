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
  /** The pool entry this dump produced. */
  word: { lemma: string; pos: string; translation: string; rung: number; usageNote: string | null } | null;
  /** Committed, but the word was already in the pool. */
  alreadyInPool: boolean;
};

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
  expected: string;
  accentSlip: boolean;
  next: { rung: number; intervalDays: number; dueOn: string };
};
