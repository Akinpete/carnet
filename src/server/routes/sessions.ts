import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { reviews, sessionsGenerated, SLOTS, userWords, users } from "../../db/schema.sqlite.ts";
import { gradeLocally, MAX_RUNG, type LocalAnswer } from "../../shared/cards.ts";
import type { AnswerResult, SessionView, TodayView } from "../../shared/types.ts";
import type { Ctx } from "../ctx.ts";
import type { AppEnv } from "../env.ts";
import { AppError } from "../errors.ts";
import { newId } from "../ids.ts";
import { addDays, todayIn } from "../lib/dates.ts";
import { requireAuth } from "../middleware/auth.ts";
import { idempotency } from "../middleware/idempotency.ts";
import { schedule, type Grade, type Rung } from "../services/scheduler.ts";
import { buildCards, selectSessionWords } from "../services/sessions.ts";
import { validate } from "../validate.ts";

/** M1 offers one session a day, stored in the morning slot. Three a day is M3. */
const DAILY_SLOT = "morning" satisfies (typeof SLOTS)[number];

async function userToday(ctx: Ctx, userId: string): Promise<string> {
  const user = await ctx.db.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId)).get();
  return todayIn(user?.timezone ?? "UTC");
}

function findSession(ctx: Ctx, userId: string, forDate: string) {
  return ctx.db
    .select()
    .from(sessionsGenerated)
    .where(and(eq(sessionsGenerated.userId, userId), eq(sessionsGenerated.forDate, forDate), eq(sessionsGenerated.slot, DAILY_SLOT)))
    .get();
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
    text: z.string().max(200).optional(),
    dontKnow: z.literal(true).optional(),
    latencyMs: z.number().int().min(0).max(3_600_000).optional(),
  })
  .refine((b) => [b.choice !== undefined, b.text !== undefined, b.dontKnow].filter(Boolean).length === 1, {
    error: "Send exactly one of choice, text or dontKnow.",
  });

export const sessionRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .use(idempotency)
  .get("/today", async (c) => {
    const { ctx, user } = c.var;
    const today = await userToday(ctx, user.id);
    const session = await findSession(ctx, user.id, today);
    let view: TodayView;
    if (session) {
      const answered = (await answeredIn(ctx, session.id)).length;
      const done = session.completedAt !== null || answered >= session.cards.length;
      view = { forDate: today, total: session.cards.length, answered, state: done ? "completed" : "in_progress" };
    } else {
      const total = (await selectSessionWords(ctx.db, user.id, today)).length;
      view = { forDate: today, total, answered: 0, state: total === 0 ? "nothing_due" : "ready" };
    }
    return c.json(view, 200);
  })
  .post("/:slot/start", async (c) => {
    const { ctx, user } = c.var;
    if (c.req.param("slot") !== DAILY_SLOT) {
      throw new AppError(400, "invalid_slot", "There's one session a day for now.");
    }
    const today = await userToday(ctx, user.id);
    // Idempotent per slot per day: a started session is reopened, never regenerated.
    let session = await findSession(ctx, user.id, today);
    if (!session) {
      const cards = buildCards(await selectSessionWords(ctx.db, user.id, today));
      if (cards.length === 0) throw new AppError(409, "nothing_due", "Nothing is due today. Add some words and come back tomorrow.");
      await ctx.db
        .insert(sessionsGenerated)
        .values({ id: newId("ses"), userId: user.id, slot: DAILY_SLOT, forDate: today, cards, startedAt: Date.now() })
        .onConflictDoNothing();
      session = await findSession(ctx, user.id, today);
      if (!session) throw new AppError(500, "internal", "The session wasn't saved.");
    }
    const view: SessionView = {
      id: session.id,
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

    // Rungs 1–2 are graded here, with no model call. Right = 3, wrong = 0
    // (grades 1, 2 and 4 need judgement that arrives with open-form grading in M3).
    const answer: LocalAnswer =
      body.choice !== undefined ? { choice: body.choice } : body.text !== undefined ? { text: body.text } : { dontKnow: true };
    const result = gradeLocally(card, answer);
    const grade: Grade = result.correct ? 3 : 0;
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
        answerText,
        latencyMs: body.latencyMs ?? null,
        createdAt: Date.now(),
      }),
      ctx.db
        .update(userWords)
        .set({ ...next, dueOn })
        .where(and(eq(userWords.userId, user.id), eq(userWords.wordId, body.wordId))),
    ]);

    const view: AnswerResult = {
      correct: result.correct,
      expected: result.expected,
      accentSlip: result.accentSlip,
      next: { rung: next.rung, intervalDays: next.intervalDays, dueOn },
    };
    return c.json(view, 200);
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
