import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { dumps, userWords, words } from "../../db/schema.sqlite.ts";
import type { DumpView } from "../../shared/types.ts";
import type { Ctx } from "../ctx.ts";
import type { AppEnv } from "../env.ts";
import { AppError } from "../errors.ts";
import { newId } from "../ids.ts";
import { requireAuth } from "../middleware/auth.ts";
import { idempotency } from "../middleware/idempotency.ts";
import { rateLimitByUser } from "../middleware/rateLimit.ts";
import { enrichTypedDump } from "../services/enrich.ts";
import { validate } from "../validate.ts";

const createBody = z.object({
  text: z
    .string()
    .trim()
    .min(1, { error: "Type a word or phrase." })
    .max(120, { error: "Type one word or phrase. Pasting longer text arrives soon." }),
});

/** Dumps with the pool entry each one produced, newest first. */
function listQuery(ctx: Ctx, userId: string, dumpId?: string) {
  return ctx.db
    .select({
      id: dumps.id,
      kind: dumps.kind,
      text: dumps.rawText,
      status: dumps.status,
      error: dumps.error,
      createdAt: dumps.createdAt,
      lemma: words.lemma,
      pos: words.pos,
      translation: words.translation,
      usageNote: words.usageNote,
      rung: userWords.rung,
    })
    .from(dumps)
    .leftJoin(userWords, and(eq(userWords.sourceDumpId, dumps.id), eq(userWords.userId, dumps.userId)))
    .leftJoin(words, eq(words.id, userWords.wordId))
    .where(dumpId ? and(eq(dumps.userId, userId), eq(dumps.id, dumpId)) : eq(dumps.userId, userId))
    .orderBy(desc(dumps.createdAt));
}

type Row = Awaited<ReturnType<typeof listQuery>>[number];

const toView = (r: Row): DumpView => ({
  id: r.id,
  kind: r.kind,
  text: r.text ?? "",
  status: r.status,
  error: r.error,
  createdAt: r.createdAt,
  word:
    r.lemma && r.pos && r.translation && r.rung
      ? { lemma: r.lemma, pos: r.pos, translation: r.translation, rung: r.rung, usageNote: r.usageNote }
      : null,
  // Committed without producing a pool entry: the word was already there.
  alreadyInPool: r.status === "committed" && !r.lemma,
});

export const dumpRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .use(idempotency)
  .post("/", rateLimitByUser("dumps", 50, 24 * 60 * 60), validate("json", createBody), async (c) => {
    const { ctx, user } = c.var;
    const id = newId("dmp");
    await ctx.db.insert(dumps).values({
      id,
      userId: user.id,
      kind: "text",
      rawText: c.req.valid("json").text,
      status: "extracting",
      createdAt: Date.now(),
    });
    ctx.defer(() => enrichTypedDump(ctx, id));
    const row = await listQuery(ctx, user.id, id).get();
    if (!row) throw new AppError(500, "internal", "The dump wasn't saved.");
    return c.json({ dump: toView(row) }, 202);
  })
  .get("/", async (c) => {
    const rows = await listQuery(c.var.ctx, c.var.user.id).limit(30);
    return c.json({ dumps: rows.map(toView) }, 200);
  })
  .get("/:id", async (c) => {
    const row = await listQuery(c.var.ctx, c.var.user.id, c.req.param("id")).get();
    if (!row) throw new AppError(404, "dump_not_found", "There's no such dump.");
    return c.json({ dump: toView(row) }, 200);
  });
