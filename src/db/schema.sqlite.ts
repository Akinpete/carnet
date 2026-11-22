// The SQLite / D1 target. Table shapes follow BACKEND.md. `journal_entries`
// and `curriculum_state` arrive with M4 and M5.
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { Card } from "../shared/cards.ts";
import { bool, json, timestampMs } from "./columns.ts";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  timezone: text("timezone").notNull().default("UTC"),
  createdAt: timestampMs("created_at").notNull(),
});

export const DUMP_KINDS = ["image", "audio", "url", "text"] as const;
export const DUMP_STATUSES = ["pending", "extracting", "awaiting_review", "committed", "failed"] as const;

export const dumps = sqliteTable(
  "dumps",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind", { enum: DUMP_KINDS }).notNull(),
    sourceRef: text("source_ref"), // storage key, or the url
    rawText: text("raw_text"), // what was typed; extracted French from M2 on
    status: text("status", { enum: DUMP_STATUSES }).notNull(),
    error: text("error"), // shown to the learner when status is `failed`
    createdAt: timestampMs("created_at").notNull(),
  },
  (t) => [index("dumps_user_status").on(t.userId, t.status, t.createdAt)],
);

export const POS = ["noun", "verb", "adj", "adv", "pron", "other"] as const;

// Global. One row per French lemma, shared by every user. Writes are
// idempotent on (lemma, pos).
export const words = sqliteTable(
  "words",
  {
    id: text("id").primaryKey(),
    /** Dictionary form; nouns carry their article ("la grève", "l'hôtel"). */
    lemma: text("lemma").notNull(),
    pos: text("pos", { enum: POS }).notNull(),
    gender: text("gender", { enum: ["m", "f"] }),
    translation: text("translation").notNull(),
    gloss: text("gloss"),
    usageNote: text("usage_note"), // the trap, when there is one
    /** Three plausible wrong meanings for recognition cards (M1 decision). */
    distractors: json<string[]>("distractors"),
    audioKey: text("audio_key"), // storage key, null until synthesised
    createdAt: timestampMs("created_at").notNull(),
  },
  (t) => [uniqueIndex("words_lemma_pos").on(t.lemma, t.pos)],
);

// Per learner.
export const userWords = sqliteTable(
  "user_words",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    wordId: text("word_id")
      .notNull()
      .references(() => words.id),
    rung: integer("rung").notNull().default(1), // 1..5
    ease: real("ease").notNull().default(2.5),
    intervalDays: integer("interval_days").notNull().default(0),
    dueOn: text("due_on").notNull(), // YYYY-MM-DD in the user's timezone
    reps: integer("reps").notNull().default(0),
    lapses: integer("lapses").notNull().default(0),
    isLeech: bool("is_leech").notNull().default(false),
    origin: text("origin", { enum: ["dump", "journal"] }).notNull(),
    sourceDumpId: text("source_dump_id").references(() => dumps.id),
    createdAt: timestampMs("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.wordId] }), index("uw_due").on(t.userId, t.dueOn, t.isLeech)],
);

// Append-only. Never updated, never deleted (except by account deletion).
export const reviews = sqliteTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    wordId: text("word_id").notNull(),
    sessionId: text("session_id"),
    rung: integer("rung").notNull(), // rung asked at
    grade: integer("grade").notNull(), // 0..4
    errorKind: text("error_kind"), // see BACKEND.md, Grading (from M3)
    answerText: text("answer_text"),
    contested: bool("contested").notNull().default(false),
    edited: bool("edited").notNull().default(false), // spoken transcript changed before submit (M3)
    latencyMs: integer("latency_ms"),
    createdAt: timestampMs("created_at").notNull(),
  },
  (t) => [
    index("reviews_user_word").on(t.userId, t.wordId, t.createdAt),
    uniqueIndex("reviews_session_word").on(t.sessionId, t.wordId),
  ],
);

export const SLOTS = ["morning", "midday", "evening"] as const;

export const sessionsGenerated = sqliteTable(
  "sessions_generated",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    slot: text("slot", { enum: SLOTS }).notNull(),
    forDate: text("for_date").notNull(), // YYYY-MM-DD
    cards: json<Card[]>("cards").notNull(),
    startedAt: timestampMs("started_at"),
    completedAt: timestampMs("completed_at"),
  },
  (t) => [uniqueIndex("sess_slot").on(t.userId, t.forDate, t.slot)],
);
