import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { reviews, SESSION_SLOTS, sessionsGenerated, SLOTS, userWords, users, words } from "../../db/schema.sqlite.ts";
import { gradeLocally, isLocal, isSpeaking, MAX_RUNG, type LocalAnswer } from "../../shared/cards.ts";
import type { AnswerResult, SessionSlot, SessionView, TodayView } from "../../shared/types.ts";
import type { Ctx } from "../ctx.ts";
import type { AppEnv } from "../env.ts";
import { AppError } from "../errors.ts";
import { newId } from "../ids.ts";
import { addDays, todayIn } from "../lib/dates.ts";
import { requireAuth } from "../middleware/auth.ts";
import { idempotency } from "../middleware/idempotency.ts";
import { AiError } from "../ai.ts";
import { gradeComprehension, gradeProduction, type Judgement } from "../services/grade.ts";
import { schedule, type Grade, type Rung } from "../services/scheduler.ts";
import {
  buildCards,
  countPracticeWords,
  ensureExamples,
  selectPracticeWords,
  selectSessionWords,
} from "../services/sessions.ts";
import { validate } from "../validate.ts";

type Slot = (typeof SESSION_SLOTS)[number];
type SessionRow = typeof sessionsGenerated.$inferSelect;

const isSlot = (s: string): s is Slot => (SESSION_SLOTS as readonly string[]).includes(s);

async function userToday(ctx: Ctx, userId: string): Promise<string> {
  const user = await ctx.db.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId)).get();
  return todayIn(user?.timezone ?? "UTC");
}

function findSession(ctx: Ctx, userId: string, forDate: string, slot: Slot) {
  return ctx.db
    .select()
    .from(sessionsGenerated)
    .where(and(eq(sessionsGenerated.userId, userId), eq(sessionsGenerated.forDate, forDate), eq(sessionsGenerated.slot, slot)))
    .get();
}

/** Today's real sessions (not practice), in slot order, with how far each got. */
async function todaysSessions(ctx: Ctx, userId: string, forDate: string) {
  const rows = await ctx.db
    .select()
    .from(sessionsGenerated)
    .where(and(eq(sessionsGenerated.userId, userId), eq(sessionsGenerated.forDate, forDate)))
    .all();
  const real = rows
    .filter((r): r is SessionRow & { slot: SessionSlot } => r.slot !== "practice")
    .sort((a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot));
  return Promise.all(
    real.map(async (r) => {
      const answered = (await answeredIn(ctx, r.id)).length;
      return { row: r, answered, done: r.completedAt !== null || answered >= r.cards.length };
    }),
  );
}

async function answeredIn(ctx: Ctx, sessionId: string) {
  const rows = await ctx.db
    .select({ wordId: reviews.wordId, grade: reviews.grade })
    .from(reviews)
    .where(eq(reviews.sessionId, sessionId));
  return rows.map((r) => ({ wordId: r.wordId, correct: r.grade >= 2 }));
}

async function ownedSession(ctx: Ctx, userId: string, id: string) {
  const session = await ctx.db
    .select()
    .from(sessionsGenerated)
    .where(and(eq(sessionsGenerated.id, id), eq(sessionsGenerated.userId, userId)))
    .get();
  if (!session) throw new AppError(404, "session_not_found", "There's no such session.");
  return session;
}

const answerBody = z
  .object({
    wordId: z.string().min(1).max(64),
    choice: z.number().int().min(0).max(9).optional(),
    text: z.string().max(400).optional(),
    dontKnow: z.literal(true).optional(),
    /** Speaking cards: "Skip — I can't say this yet". */
    skipped: z.literal(true).optional(),
    /** Speaking cards: how the text was produced. */
    mode: z.enum(["spoken", "typed"]).optional(),
    /** Spoken answers: the transcript was changed by hand before sending. */
    edited: z.boolean().optional(),
    latencyMs: z.number().int().min(0).max(3_600_000).optional(),
  })
  .refine((b) => [b.choice !== undefined, b.text !== undefined, b.dontKnow, b.skipped].filter(Boolean).length === 1, {
    error: "Send exactly one of choice, text, dontKnow or skipped.",
  });

export const sessionRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .use(idempotency)
  .get("/today", async (c) => {
    const { ctx, user } = c.var;
    const today = await userToday(ctx, user.id);
    const sessions = await todaysSessions(ctx, user.id, today);
    const done = sessions.filter((x) => x.done).length;
    const reviewedToday = sessions.reduce((n, x) => n + x.answered, 0);
    const practice = await countPracticeWords(ctx.db, user.id, today);
    const base = { forDate: today, done, reviewedToday, practice };

    const open = sessions.find((x) => !x.done);
    let view: TodayView;
    if (open) {
      view = { ...base, slot: open.row.slot, total: open.row.cards.length, answered: open.answered, state: "in_progress" };
    } else {
      // The next slot opens only with words that are really due: new ones, or ones the cap left out.
      const slot = SLOTS[sessions.length] ?? null;
      const total = slot ? (await selectSessionWords(ctx.db, user.id, today)).length : 0;
      const state = total > 0 ? "ready" : sessions.length > 0 ? "completed" : "nothing_due";
      view = { ...base, slot, total, answered: 0, state };
    }
    return c.json(view, 200);
  })
  .post("/:slot/start", async (c) => {
    const { ctx, user } = c.var;
    const slot = c.req.param("slot");
    if (!isSlot(slot)) throw new AppError(400, "invalid_slot", "There's no such session.");
    const today = await userToday(ctx, user.id);
    let session: SessionRow | undefined;

    if (slot === "practice") {
      // Each practice round is fresh: the day's practice row is replaced, its reviews stay (append-only).
      const cards = buildCards(await ensureExamples(ctx, await selectPracticeWords(ctx.db, user.id, today)));
      if (cards.length === 0) {
        throw new AppError(409, "nothing_to_practise", "Nothing to practise yet. Words you've reviewed come back here until they're due.");
      }
      const id = newId("ses");
      await ctx.tx([
        ctx.db
          .delete(sessionsGenerated)
          .where(and(eq(sessionsGenerated.userId, user.id), eq(sessionsGenerated.forDate, today), eq(sessionsGenerated.slot, "practice"))),
        ctx.db.insert(sessionsGenerated).values({ id, userId: user.id, slot, forDate: today, cards, startedAt: Date.now() }),
      ]);
      session = await findSession(ctx, user.id, today, slot);
    } else {
      // Idempotent per slot per day: a started session is reopened, never regenerated.
      session = await findSession(ctx, user.id, today, slot);
      if (!session) {
        const sessions = await todaysSessions(ctx, user.id, today);
        if (SLOTS.indexOf(slot) !== sessions.length || sessions.some((x) => !x.done)) {
          throw new AppError(409, "session_out_of_order", "Finish the session you've started first.");
        }
        const cards = buildCards(await ensureExamples(ctx, await selectSessionWords(ctx.db, user.id, today)));
        if (cards.length === 0) {
          throw new AppError(409, "nothing_due", "Nothing is due right now. Add some words, or practise the ones you have.");
        }
        await ctx.db
          .insert(sessionsGenerated)
          .values({ id: newId("ses"), userId: user.id, slot, forDate: today, cards, startedAt: Date.now() })
          .onConflictDoNothing();
        session = await findSession(ctx, user.id, today, slot);
      }
    }
    if (!session) throw new AppError(500, "internal", "The session wasn't saved.");
    const view: SessionView = {
      id: session.id,
      slot: session.slot,
      forDate: session.forDate,
      cards: session.cards,
      answered: await answeredIn(ctx, session.id),
      completed: session.completedAt !== null,
    };
    return c.json({ session: view }, 200);
  })
  .post("/:id/answer", validate("json", answerBody), async (c) => {
    const { ctx, user } = c.var;
    const body = c.req.valid("json");
    const session = await ownedSession(ctx, user.id, c.req.param("id"));
    if (session.completedAt !== null) throw new AppError(409, "session_completed", "This session is already finished.");
    const card = session.cards.find((k) => k.wordId === body.wordId);
    if (!card) throw new AppError(404, "card_not_found", "That card isn't in this session.");

    const already = await ctx.db
      .select({ id: reviews.id })
      .from(reviews)
      .where(and(eq(reviews.sessionId, session.id), eq(reviews.wordId, body.wordId)))
      .get();
    if (already) throw new AppError(409, "already_answered", "That card has already been answered.");

    const state = await ctx.db
      .select()
      .from(userWords)
      .where(and(eq(userWords.userId, user.id), eq(userWords.wordId, body.wordId)))
      .get();
    if (!state) throw new AppError(404, "word_not_found", "That word isn't in your pool any more.");

    const answer: LocalAnswer =
      body.choice !== undefined ? { choice: body.choice } : body.text !== undefined ? { text: body.text } : { dontKnow: true };
    let grade: Grade;
    let correct: boolean;
    let expected: string;
    let accentSlip = false;
    let judged: Judgement | null = null;

    if (isLocal(card)) {
      // Rungs 1–2 are graded here, with no model call. Right = 3, wrong = 0.
      const result = gradeLocally(card, answer);
      grade = result.correct ? 3 : 0;
      ({ correct, expected, accentSlip } = result);
    } else if (body.skipped) {
      // Skipped, not forgotten (on a train, say): a lapse that holds the rung, back tomorrow.
      judged = { grade: 1, correct: false, close: false, errorKind: null, meaning: card.type === "production" ? card.translation : "", explanation: null };
      ({ grade, correct } = judged);
      expected = judged.meaning;
    } else {
      // Rungs 3–4: the model judges. If it can't, nothing is recorded and the card can be tried again.
      const word = await ctx.db.select({ translation: words.translation }).from(words).where(eq(words.id, card.wordId)).get();
      const translation = word?.translation ?? "";
      const given = "text" in answer ? answer.text.trim() : "";
      if (!given) {
        judged = { grade: 0, correct: false, close: false, errorKind: "forgot", meaning: translation, explanation: null };
      } else {
        if (!ctx.ai) throw new AppError(503, "grading_unavailable", "Checking answers isn't set up on this server yet.");
        const ai = { ...ctx, ai: ctx.ai };
        try {
          judged =
            card.type === "production"
              ? await gradeProduction(ai, card, given)
              : await gradeComprehension(ai, card, translation, given);
        } catch (err) {
          if (!(err instanceof AiError)) throw err;
          console.error("grading failed", session.id, card.wordId, err);
          throw new AppError(503, "grading_failed", "Couldn't check that answer just now. Try again.");
        }
      }
      ({ grade, correct } = judged);
      expected = judged.meaning;
    }

    const next = schedule(
      {
        rung: state.rung as Rung,
        ease: state.ease,
        intervalDays: state.intervalDays,
        reps: state.reps,
        lapses: state.lapses,
        isLeech: state.isLeech,
      },
      grade,
      MAX_RUNG,
    );
    const today = await userToday(ctx, user.id);
    const dueOn = addDays(today, next.intervalDays);
    // Practice is graded and logged, but the word's schedule stays exactly where it was.
    const practice = session.slot === "practice";
    const answerText =
      "text" in answer ? answer.text : "choice" in answer && card.type === "recognition" ? (card.choices[answer.choice] ?? null) : null;

    await ctx.tx([
      ctx.db.insert(reviews).values({
        id: newId("rev"),
        userId: user.id,
        wordId: body.wordId,
        sessionId: session.id,
        rung: card.rung,
        grade,
        errorKind: judged?.errorKind ?? null,
        answerText,
        edited: body.mode === "spoken" && body.edited === true,
        answerMode: isSpeaking(card) ? (body.skipped ? "skipped" : (body.mode ?? "typed")) : null,
        latencyMs: body.latencyMs ?? null,
        createdAt: Date.now(),
      }),
      ...(practice
        ? []
        : [
            ctx.db
              .update(userWords)
              .set({ ...next, dueOn })
              .where(and(eq(userWords.userId, user.id), eq(userWords.wordId, body.wordId))),
          ]),
    ]);

    const view: AnswerResult = {
      correct,
      expected,
      accentSlip,
      next: practice
        ? { rung: state.rung, intervalDays: state.intervalDays, dueOn: state.dueOn }
        : { rung: next.rung, intervalDays: next.intervalDays, dueOn },
      ...(practice ? { practice: true as const } : {}),
      ...(judged
        ? {
            judged: {
              close: judged.close,
              errorKind: judged.errorKind,
              explanation: judged.explanation,
              corrected: judged.corrected ?? null,
              example: judged.example ?? null,
            },
          }
        : {}),
    };
    return c.json(view, 200);
  })
  // "This was unfair": the one write a review allows after the fact. It marks the
  // grade for calibration (BACKEND.md, The tuning problem); it doesn't change it.
  .post("/:id/contest", validate("json", z.object({ wordId: z.string().min(1).max(64) })), async (c) => {
    const { ctx, user } = c.var;
    const session = await ownedSession(ctx, user.id, c.req.param("id"));
    const { wordId } = c.req.valid("json");
    const review = await ctx.db
      .select({ id: reviews.id })
      .from(reviews)
      .where(and(eq(reviews.sessionId, session.id), eq(reviews.wordId, wordId), eq(reviews.userId, user.id)))
      .get();
    if (!review) throw new AppError(404, "review_not_found", "That card hasn't been answered in this session.");
    await ctx.db.update(reviews).set({ contested: true }).where(eq(reviews.id, review.id));
    return c.json({ contested: true }, 200);
  })
  .post("/:id/complete", async (c) => {
    const { ctx, user } = c.var;
    const session = await ownedSession(ctx, user.id, c.req.param("id"));
    if (session.completedAt === null) {
      await ctx.db.update(sessionsGenerated).set({ completedAt: Date.now() }).where(eq(sessionsGenerated.id, session.id));
    }
    const answered = await answeredIn(ctx, session.id);
    return c.json({ total: session.cards.length, answered: answered.length, correct: answered.filter((a) => a.correct).length }, 200);
  });
