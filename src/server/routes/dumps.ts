import { and, desc, eq, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { Hono } from "hono";
import { z } from "zod";
import { dumpCandidates, dumps, userWords, words } from "../../db/schema.sqlite.ts";
import type { CandidateView, DumpDetail, DumpView } from "../../shared/types.ts";
import { AiError } from "../ai.ts";
import type { Ctx } from "../ctx.ts";
import type { AppEnv } from "../env.ts";
import { AppError } from "../errors.ts";
import { newId } from "../ids.ts";
import { requireAuth } from "../middleware/auth.ts";
import { idempotency } from "../middleware/idempotency.ts";
import { rateLimitByUser } from "../middleware/rateLimit.ts";
import { lookUpOne } from "../services/enrich.ts";
import { MAX_CANDIDATES, MESSAGES, poolWrites, processDump } from "../services/extract.ts";
import { isUrl } from "../../shared/links.ts";
import { validate } from "../validate.ts";

/** Biggest screenshot accepted. The app shrinks them to well under this before upload. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

/** Longest paste a text dump takes. A screenful of an article, not the whole thing. */
export const MAX_DUMP_TEXT = 2000;

/** Past this, a dump still `extracting` was cut off (Workers stop deferred work at 30 s). */
const EXTRACT_DEADLINE_MS = 40_000;

const DAY = 24 * 60 * 60;

const createBody = z.object({
  text: z
    .string()
    .trim()
    .min(1, { error: "Type a word or phrase, or paste some French." })
    .max(MAX_DUMP_TEXT, { error: `That's too long. Paste up to ${MAX_DUMP_TEXT} characters at a time.` }),
});

const imageBody = z.object({
  image: z
    .instanceof(File, { error: "Attach a screenshot." })
    .refine((f) => f.size > 0, { error: "That image is empty." })
    .refine((f) => f.size <= MAX_IMAGE_BYTES, { error: "That image is too big. Try a screenshot instead." })
    .refine((f) => (IMAGE_TYPES as readonly string[]).includes(f.type), {
      error: "That isn't an image Carnet can read. Use a screenshot (PNG or JPEG).",
    }),
});

const commitBody = z.object({
  wordIds: z
    .array(z.string().max(40))
    .min(1, { error: "Tick at least one word to keep." })
    .max(MAX_CANDIDATES * 2),
});

const correctBody = z.object({
  text: z.string().trim().min(1, { error: "Type the word as it should be." }).max(80),
});

const NOT_A_WORD: Record<"sentence" | "not_french" | "unclear", string> = {
  sentence: "Type one word or phrase.",
  not_french: MESSAGES.not_french,
  unclear: MESSAGES.unclear,
};

type DumpRow = typeof dumps.$inferSelect;

const isStale = (d: Pick<DumpRow, "status" | "createdAt">) =>
  d.status === "extracting" && Date.now() - d.createdAt > EXTRACT_DEADLINE_MS;

/** The inbox's view of some dumps: what each put in the pool, and what's waiting. */
async function toViews(ctx: Ctx, userId: string, rows: DumpRow[]): Promise<DumpView[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const kept = await ctx.db
    .select({
      dumpId: userWords.sourceDumpId,
      rung: userWords.rung,
      lemma: words.lemma,
      pos: words.pos,
      translation: words.translation,
      usageNote: words.usageNote,
    })
    .from(userWords)
    .innerJoin(words, eq(words.id, userWords.wordId))
    .where(and(eq(userWords.userId, userId), inArray(userWords.sourceDumpId, ids)))
    .all();

  const found = await ctx.db
    .select({ dumpId: dumpCandidates.dumpId, inPool: userWords.wordId })
    .from(dumpCandidates)
    .leftJoin(userWords, and(eq(userWords.wordId, dumpCandidates.wordId), eq(userWords.userId, userId)))
    .where(inArray(dumpCandidates.dumpId, ids))
    .all();

  return rows.map((r): DumpView => {
    const mine = kept.filter((k) => k.dumpId === r.id);
    const theirs = found.filter((f) => f.dumpId === r.id);
    const one = mine.length === 1 ? mine[0] : undefined;
    const stale = isStale(r);
    return {
      id: r.id,
      kind: r.kind,
      text: r.rawText ?? "",
      status: stale ? "failed" : r.status,
      error: stale ? MESSAGES.retry : r.error,
      createdAt: r.createdAt,
      word: one
        ? { lemma: one.lemma, pos: one.pos, translation: one.translation, rung: one.rung, usageNote: one.usageNote }
        : null,
      kept: mine.length,
      source: r.kind === "url" ? r.sourceRef : null,
      alreadyInPool: r.status === "committed" && mine.length === 0,
      found: theirs.length > 0 ? { total: theirs.length, fresh: theirs.filter((f) => !f.inPool).length } : null,
    };
  });
}

async function ownDump(ctx: Ctx, userId: string, id: string): Promise<DumpRow> {
  const row = await ctx.db
    .select()
    .from(dumps)
    .where(and(eq(dumps.userId, userId), eq(dumps.id, id)))
    .get();
  if (!row) throw new AppError(404, "dump_not_found", "There's no such dump.");
  return row;
}

async function detail(ctx: Ctx, userId: string, row: DumpRow): Promise<DumpDetail> {
  const [view] = await toViews(ctx, userId, [row]);
  if (!view) throw new AppError(500, "internal", "The dump couldn't be read.");
  const candidates = await ctx.db
    .select({
      wordId: words.id,
      lemma: words.lemma,
      pos: words.pos,
      gender: words.gender,
      translation: words.translation,
      usageNote: words.usageNote,
      form: dumpCandidates.form,
      sentence: dumpCandidates.sentence,
      inPool: userWords.wordId,
    })
    .from(dumpCandidates)
    .innerJoin(words, eq(words.id, dumpCandidates.wordId))
    .leftJoin(userWords, and(eq(userWords.wordId, dumpCandidates.wordId), eq(userWords.userId, userId)))
    .where(eq(dumpCandidates.dumpId, row.id))
    .orderBy(dumpCandidates.position)
    .all();
  return {
    ...view,
    candidates: candidates.map(({ inPool, ...c }): CandidateView => ({ ...c, known: inPool !== null })),
  };
}

function awaitingReview(row: DumpRow) {
  if (row.status !== "awaiting_review") {
    throw new AppError(409, "dump_not_awaiting_review", "This dump isn't waiting for review any more.");
  }
}

type Write = BatchItem<"sqlite">;

export const dumpRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .use(idempotency)
  .post("/", rateLimitByUser("dumps", 50, DAY), validate("json", createBody), async (c) => {
    const { ctx, user } = c.var;
    const id = newId("dmp");
    const { text } = c.req.valid("json");
    // A lone link is a link dump: the page is fetched in the background.
    const link = isUrl(text);
    await ctx.db.insert(dumps).values({
      id,
      userId: user.id,
      kind: link ? "url" : "text",
      sourceRef: link ? text.trim() : null,
      rawText: link ? null : text,
      status: "extracting",
      createdAt: Date.now(),
    });
    ctx.defer(() => processDump(ctx, id));
    const [dump] = await toViews(ctx, user.id, [await ownDump(ctx, user.id, id)]);
    return c.json({ dump: dump as DumpView }, 202);
  })
  // A screenshot. Stored privately and read by the model at the same time, from memory.
  .post("/image", rateLimitByUser("dumps", 50, DAY), validate("form", imageBody), async (c) => {
    const { ctx, user } = c.var;
    const file = c.req.valid("form").image;
    const id = newId("dmp");
    const key = `uploads/${user.id}/${id}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    await ctx.db.insert(dumps).values({
      id,
      userId: user.id,
      kind: "image",
      sourceRef: key,
      status: "extracting",
      createdAt: Date.now(),
    });
    ctx.defer(() =>
      Promise.all([
        ctx.storage
          .put(key, bytes, { contentType: file.type })
          .catch((err: unknown) => console.error("upload store failed", id, err)),
        processDump(ctx, id, { bytes, mediaType: file.type }),
      ]),
    );
    const [dump] = await toViews(ctx, user.id, [await ownDump(ctx, user.id, id)]);
    return c.json({ dump: dump as DumpView }, 202);
  })
  .get("/", async (c) => {
    const { ctx, user } = c.var;
    const rows = await ctx.db
      .select()
      .from(dumps)
      .where(eq(dumps.userId, user.id))
      .orderBy(desc(dumps.createdAt))
      .limit(30)
      .all();
    return c.json({ dumps: await toViews(ctx, user.id, rows) }, 200);
  })
  .get("/:id", async (c) => {
    const { ctx, user } = c.var;
    return c.json({ dump: await detail(ctx, user.id, await ownDump(ctx, user.id, c.req.param("id"))) }, 200);
  })
  // The screenshot itself, to its owner only. Never public.
  .get("/:id/image", async (c) => {
    const { ctx, user } = c.var;
    const row = await ownDump(ctx, user.id, c.req.param("id"));
    const object = row.kind === "image" && row.sourceRef ? await ctx.storage.get(row.sourceRef) : null;
    if (!object) throw new AppError(404, "image_not_found", "That screenshot isn't stored.");
    return new Response(object.body, {
      headers: {
        "content-type": object.contentType ?? "application/octet-stream",
        "cache-control": "private, max-age=86400",
      },
    });
  })
  // Keep the ticked words. The only write to the pool from a reviewed dump.
  .post("/:id/commit", validate("json", commitBody), async (c) => {
    const { ctx, user } = c.var;
    const row = await ownDump(ctx, user.id, c.req.param("id"));
    awaitingReview(row);
    const offered = await ctx.db
      .select({ wordId: dumpCandidates.wordId })
      .from(dumpCandidates)
      .where(eq(dumpCandidates.dumpId, row.id))
      .all();
    const wanted = new Set(c.req.valid("json").wordIds);
    const keep = offered.map((o) => o.wordId).filter((id) => wanted.has(id));
    if (keep.length === 0) throw new AppError(400, "invalid_input", "Tick at least one word to keep.", "wordIds");
    const done = ctx.db.update(dumps).set({ status: "committed", error: null }).where(eq(dumps.id, row.id));
    const writes: Write[] = [...(await poolWrites(ctx, row, keep)), done];
    await ctx.tx(writes as [Write, ...Write[]]);
    return c.json({ dump: await detail(ctx, user.id, { ...row, status: "committed", error: null }) }, 200);
  })
  // The learner fixes a word extraction misread: look the right one up and swap it in.
  .patch(
    "/:id/candidates/:wordId",
    rateLimitByUser("corrections", 100, DAY),
    validate("json", correctBody),
    async (c) => {
      const { ctx, user } = c.var;
      const row = await ownDump(ctx, user.id, c.req.param("id"));
      awaitingReview(row);
      const oldId = c.req.param("wordId");
      const old = await ctx.db
        .select()
        .from(dumpCandidates)
        .where(and(eq(dumpCandidates.dumpId, row.id), eq(dumpCandidates.wordId, oldId)))
        .get();
      if (!old) throw new AppError(404, "candidate_not_found", "That word isn't in this dump.");

      let found: Awaited<ReturnType<typeof lookUpOne>>;
      try {
        found = await lookUpOne(ctx, c.req.valid("json").text);
      } catch (err) {
        if (!(err instanceof AiError)) throw err;
        throw new AppError(503, "lookup_failed", MESSAGES.retry);
      }
      if (!found.ok) {
        if (found.reason === "no_ai" || found.reason === "retry") {
          throw new AppError(503, "lookup_failed", MESSAGES[found.reason]);
        }
        throw new AppError(400, "not_a_word", NOT_A_WORD[found.reason], "text");
      }

      if (found.wordId !== oldId) {
        const clash = await ctx.db
          .select({ wordId: dumpCandidates.wordId })
          .from(dumpCandidates)
          .where(and(eq(dumpCandidates.dumpId, row.id), eq(dumpCandidates.wordId, found.wordId)))
          .get();
        const remove = ctx.db
          .delete(dumpCandidates)
          .where(and(eq(dumpCandidates.dumpId, row.id), eq(dumpCandidates.wordId, oldId)));
        // Already offered under its right name: the misread copy just goes.
        const writes: Write[] = clash
          ? [remove]
          : [remove, ctx.db.insert(dumpCandidates).values({ ...old, wordId: found.wordId })];
        await ctx.tx(writes as [Write, ...Write[]]);
      }
      return c.json({ dump: await detail(ctx, user.id, row), wordId: found.wordId }, 200);
    },
  )
  // Throw a dump away. Not once it has put words in the pool.
  .delete("/:id", async (c) => {
    const { ctx, user } = c.var;
    const row = await ownDump(ctx, user.id, c.req.param("id"));
    if (row.status === "committed") {
      throw new AppError(409, "dump_committed", "Its words are in your pool already.");
    }
    if (row.status === "extracting" && !isStale(row)) {
      throw new AppError(409, "dump_extracting", "It's still being looked up. Try again in a moment.");
    }
    await ctx.tx([
      ctx.db.delete(dumpCandidates).where(eq(dumpCandidates.dumpId, row.id)),
      ctx.db.delete(dumps).where(eq(dumps.id, row.id)),
    ]);
    if (row.sourceRef && row.kind === "image") {
      await ctx.storage.delete(row.sourceRef).catch((err: unknown) => console.error("upload delete failed", row.id, err));
    }
    return c.json({ deleted: true }, 200);
  });
