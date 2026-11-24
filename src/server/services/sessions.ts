// Session selection and card building. Cards are built from templates
// (rungs 1–3); the model-generated, balanced session arrives with M3. Rung 3
// shows the sentence the learner met the word in, or, failing that, a short
// example generated once and kept on the shared word.
import { and, asc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { z } from "zod";
import { dumpCandidates, userWords, words } from "../../db/schema.sqlite.ts";
import { MAX_RUNG, type Card } from "../../shared/cards.ts";
import type { Ctx, Db } from "../ctx.ts";
import { orNull } from "./enrich.ts";

export const MAX_DUE = 15;
export const MAX_LEECHES = 3;
export const MAX_NEW = 5;

const columns = {
  wordId: userWords.wordId,
  rung: userWords.rung,
  dueOn: userWords.dueOn,
  isLeech: userWords.isLeech,
  lapses: userWords.lapses,
  lemma: words.lemma,
  pos: words.pos,
  gender: words.gender,
  translation: words.translation,
  gloss: words.gloss,
  usageNote: words.usageNote,
  distractors: words.distractors,
  example: words.example,
  sentence: dumpCandidates.sentence,
  form: dumpCandidates.form,
};

export type SelectedWord = Awaited<ReturnType<typeof selectSessionWords>>[number];

/**
 * In priority order (BACKEND.md, Session selection): leeches (always, max 3),
 * then the most overdue, then due today, then new words (max 5). Never pads
 * with words that aren't due: reviewing early weakens the schedule.
 */
export async function selectSessionWords(db: Db, userId: string, today: string) {
  const base = () =>
    db
      .select(columns)
      .from(userWords)
      .innerJoin(words, eq(words.id, userWords.wordId))
      // The sentence the learner met the word in, if it came from a dump with one.
      .leftJoin(dumpCandidates, and(eq(dumpCandidates.dumpId, userWords.sourceDumpId), eq(dumpCandidates.wordId, userWords.wordId)));
  const seen = or(gt(userWords.reps, 0), gt(userWords.lapses, 0));

  const leeches = await base()
    .where(and(eq(userWords.userId, userId), eq(userWords.isLeech, true)))
    .orderBy(asc(userWords.dueOn))
    .limit(MAX_LEECHES);

  const due = await base()
    .where(and(eq(userWords.userId, userId), lte(userWords.dueOn, today), eq(userWords.isLeech, false), seen))
    .orderBy(asc(userWords.dueOn), asc(userWords.createdAt))
    .limit(MAX_DUE - leeches.length);

  const fresh = await base()
    .where(and(eq(userWords.userId, userId), eq(userWords.reps, 0), eq(userWords.lapses, 0), lte(userWords.dueOn, today)))
    .orderBy(asc(userWords.createdAt))
    .limit(MAX_NEW);

  return [...leeches, ...due, ...fresh];
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

export const EXAMPLE_SYSTEM = `You write example sentences for an English-speaking beginner learning French.
You get French dictionary entries, one per line as "lemma (pos): meaning". Reply with JSON only: {"examples": [{"lemma": ..., "fr": ..., "form": ...}]}, one per line, in the same order.
"lemma": as given.
"fr": one short, everyday French sentence (6 to 12 words) using the word in the meaning given, at a beginner's level. Present or passé composé. No names of real people.
"form": the word exactly as it appears in your sentence (conjugated, plural or feminine as written), so it can be highlighted.`;

const exampleReply = z.object({
  examples: z.array(z.object({ lemma: z.string(), fr: z.string().min(8).max(200), form: orNull(z.string().max(80)) })).max(20),
});

const EXAMPLE_BATCH = 3;

/**
 * Rung 3 needs a sentence. Words with neither a source sentence nor a stored
 * example get one, generated in small parallel batches and kept on the shared
 * word so nobody pays for it twice. Failure is fine: those words get a recall
 * card today instead.
 */
export async function ensureExamples(ctx: Ctx, selected: SelectedWord[]): Promise<SelectedWord[]> {
  const needs = selected.filter((w) => w.rung >= 3 && !w.sentence && !w.example);
  if (needs.length === 0 || !ctx.ai) return selected;
  const ai = ctx.ai;
  const batches: SelectedWord[][] = [];
  for (let i = 0; i < needs.length; i += EXAMPLE_BATCH) batches.push(needs.slice(i, i + EXAMPLE_BATCH));
  const results = await Promise.allSettled(
    batches.map((batch) =>
      ai.chat({
        route: "generate",
        system: EXAMPLE_SYSTEM,
        user: batch.map((w) => `${w.lemma} (${w.pos}): ${w.translation}`).join("\n"),
        schema: exampleReply,
        maxTokens: 90 * batch.length + 100,
        timeoutMs: 10_000,
      }),
    ),
  );
  const made = new Map<string, { fr: string; form: string | null }>();
  results.forEach((r, b) => {
    if (r.status !== "fulfilled") return;
    const batch = batches[b] ?? [];
    r.value.examples.forEach((e, i) => {
      const word = batch.find((w) => w.lemma === e.lemma.trim()) ?? (r.value.examples.length === batch.length ? batch[i] : undefined);
      if (word) made.set(word.wordId, { fr: e.fr.trim(), form: e.form?.trim() || null });
    });
  });
  if (made.size === 0) return selected;
  // Only where still empty: the first example written for a word is the one everyone sees.
  const writes: BatchItem<"sqlite">[] = [...made].map(([id, example]) =>
    ctx.db.update(words).set({ example }).where(and(eq(words.id, id), isNull(words.example))),
  );
  await ctx.tx(writes as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  const stored = await ctx.db
    .select({ id: words.id, example: words.example })
    .from(words)
    .where(inArray(words.id, [...made.keys()]))
    .all();
  const byId = new Map(stored.map((w) => [w.id, w.example]));
  return selected.map((w) => (byId.has(w.wordId) ? { ...w, example: byId.get(w.wordId) ?? null } : w));
}

/** One card per word, at the word's rung (capped at the highest card type built). */
export function buildCards(selected: SelectedWord[], random: () => number = Math.random): Card[] {
  const otherMeanings = (wordId: string) =>
    selected.filter((w) => w.wordId !== wordId).map((w) => w.translation);

  return selected.map((w): Card => {
    const base = { wordId: w.wordId, pos: w.pos, gender: w.gender, usageNote: w.usageNote };
    const rung = Math.min(w.rung, MAX_RUNG);
    // Rung 3 needs a sentence; without one, the word gets a recall card today.
    const sentence = w.sentence ? { fr: w.sentence, form: w.form, source: "dump" as const } : w.example ? { ...w.example, source: "example" as const } : null;
    if (rung >= 3 && sentence) {
      return { ...base, rung: 3, type: "comprehension", prompt: sentence.fr, form: sentence.form, lemma: w.lemma, source: sentence.source };
    }
    if (rung >= 2) {
      return { ...base, rung: 2, type: "recall", prompt: w.translation, gloss: w.gloss, answer: w.lemma };
    }
    // Stored distractors first; other words' meanings only if those are missing.
    const wrong = [...new Set([...(w.distractors ?? []), ...otherMeanings(w.wordId)])]
      .filter((d) => d.toLowerCase() !== w.translation.toLowerCase())
      .slice(0, 3);
    const choices = shuffle([w.translation, ...wrong], random);
    return { ...base, rung: 1, type: "recognition", prompt: w.lemma, choices, answerIndex: choices.indexOf(w.translation) };
  });
}
