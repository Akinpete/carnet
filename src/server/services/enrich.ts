// Turns a typed word or phrase into a pool entry. In M1 a dump is one typed
// item: look it up (shared `words` cache first, then one model call), then
// commit it straight to the learner's pool. Review-before-commit is M2.
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { dumps, POS, userWords, words } from "../../db/schema.sqlite.ts";
import { AiError } from "../ai.ts";
import type { Ctx } from "../ctx.ts";
import { newId } from "../ids.ts";
import { todayIn } from "../lib/dates.ts";
import { NEW_WORD } from "./scheduler.ts";

export const ENRICH_SYSTEM = `You are a French lexicographer helping an English-speaking beginner.
The learner typed something they met in French. Identify it and reply with JSON only, using exactly these keys:

"kind": "word" for a single French word or a fixed expression (up to about five words); "sentence" for a full clause or longer text; "not_french" if it isn't French; "unclear" if you can't tell what it is.
"lemma": the dictionary form. Verbs in the infinitive, keeping "se"/"s'" if the learner typed a pronominal verb ("s'éloigner"). Nouns in the singular WITH the definite article: "la grève", "le patron", "l'hôtel" ("l'" before a vowel or mute h; "le"/"la" before an aspirated h, as in "le héros"). Adjectives in the masculine singular. Expressions in their usual form ("avoir besoin de"). Correct obvious misspellings and missing accents.
"pos": one of "noun", "verb", "adj", "adv", "pron", "other" (expressions are "other").
"gender": "m" or "f" for nouns, otherwise null.
"translation": the most common modern English meaning, short. Verbs start with "to"; nouns start with "the". At most two senses, separated by " · ".
"gloss": one short extra sense or nuance in English, or null.
"usageNote": one sentence about a real trap for English speakers, or null. The most important trap is a false friend: a French word that looks like an English word with a different meaning (actuellement is not "actually", éventuellement is not "eventually", la librairie is not "the library"). Confusion with a similar French word also counts. Never invent a note from a partial resemblance; when there is no real trap, use null.
"distractors": exactly three WRONG English meanings, for a multiple-choice question. Make them tempting for an English speaker (the English look-alike, meanings of similar French words) but clearly wrong. All three must differ from each other, and none may be a meaning or synonym of the word. Same style and length as "translation".

For anything that isn't "word", still include every key, using null.

Examples.
For "grève":
{"kind":"word","lemma":"la grève","pos":"noun","gender":"f","translation":"the strike","gloss":"rarely, a shore or riverbank","usageNote":"It looks like \\"grief\\", but it almost always means a strike.","distractors":["the grief","the grave","the gravel"]}
For "actuellement":
{"kind":"word","lemma":"actuellement","pos":"adv","gender":null,"translation":"currently · at the moment","gloss":null,"usageNote":"A false friend: it means \\"currently\\", not \\"actually\\" (which is en fait).","distractors":["actually","eventually","accurately"]}
For "fenetre":
{"kind":"word","lemma":"la fenêtre","pos":"noun","gender":"f","translation":"the window","gloss":null,"usageNote":null,"distractors":["the fence","the feather","the fan"]}`;

/** Models sometimes send "" where null is meant. */
const orNull = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), schema.nullish());

/**
 * Keeps only distractors that are really wrong: distinct, non-empty, and not
 * one of the word's own senses. A short list is fine; cards fill the gap
 * from other words in the pool.
 */
export function cleanDistractors(distractors: readonly string[], translation: string): string[] {
  const key = (s: string) => s.trim().toLowerCase().replace(/^(the|to|a|an)\s+/, "").trim();
  const senses = new Set(translation.split("·").map(key));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of distractors) {
    const k = key(d);
    if (!k || senses.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(d.trim());
  }
  return out.slice(0, 3);
}

export const enrichReply = z.object({
  kind: z.enum(["word", "sentence", "not_french", "unclear"]),
  lemma: orNull(z.string().max(80)),
  pos: orNull(z.enum(POS)),
  gender: orNull(z.enum(["m", "f"])),
  translation: orNull(z.string().max(120)),
  gloss: orNull(z.string().max(160)),
  usageNote: orNull(z.string().max(300)),
  distractors: z.array(z.string().max(120)).nullish(),
});

const MESSAGES = {
  sentence: "Type one word or phrase. Pasting longer text arrives soon.",
  not_french: "That doesn't look like French.",
  unclear: "Couldn't make sense of that. Check the spelling?",
  no_ai: "Word lookup isn't set up on this server yet.",
  retry: "The lookup didn't finish. Try again in a moment.",
} as const;

/** Exact matches in the shared cache: what was typed, or it with an article. */
function cacheCandidates(text: string): string[] {
  const t = text.trim().toLowerCase();
  const withArticles = /^[aeiouhâàéèêëîïôûü]/.test(t) ? [`l'${t}`] : [`le ${t}`, `la ${t}`];
  return [t, ...withArticles];
}

async function fail(ctx: Ctx, dumpId: string, message: string) {
  await ctx.db.update(dumps).set({ status: "failed", error: message }).where(eq(dumps.id, dumpId));
}

/** Runs in `defer` after POST /dumps returns. Never throws: failures land on the dump. */
export async function enrichTypedDump(ctx: Ctx, dumpId: string): Promise<void> {
  const { db, tx, ai } = ctx;
  const dump = await db.select().from(dumps).where(eq(dumps.id, dumpId)).get();
  if (!dump || dump.status !== "extracting" || !dump.rawText) return;
  const text = dump.rawText;

  try {
    // 1. The shared cache: a word any learner has already looked up costs nothing.
    let word = await db
      .select({ id: words.id })
      .from(words)
      .where(inArray(words.lemma, cacheCandidates(text)))
      .limit(2)
      .all()
      .then((rows) => (rows.length === 1 ? rows[0] : undefined));

    // 2. Otherwise, one model call.
    if (!word) {
      if (!ai) return fail(ctx, dumpId, MESSAGES.no_ai);
      const reply = await ai.chat({
        route: "enrich",
        system: ENRICH_SYSTEM,
        user: text,
        schema: enrichReply,
        cacheTtlSeconds: 30 * 24 * 60 * 60,
      });
      if (reply.kind !== "word") return fail(ctx, dumpId, MESSAGES[reply.kind]);
      if (!reply.lemma || !reply.pos || !reply.translation) return fail(ctx, dumpId, MESSAGES.unclear);

      // Idempotent on (lemma, pos): the first definition wins and is shared.
      const lemma = reply.lemma.trim();
      await db
        .insert(words)
        .values({
          id: newId("wrd"),
          lemma,
          pos: reply.pos,
          gender: reply.pos === "noun" ? (reply.gender ?? null) : null,
          translation: reply.translation.trim(),
          gloss: reply.gloss?.trim() || null,
          usageNote: reply.usageNote?.trim() || null,
          distractors: cleanDistractors(reply.distractors ?? [], reply.translation),
          createdAt: Date.now(),
        })
        .onConflictDoNothing({ target: [words.lemma, words.pos] });
      word = await db
        .select({ id: words.id })
        .from(words)
        .where(and(eq(words.lemma, lemma), eq(words.pos, reply.pos)))
        .get();
      if (!word) return fail(ctx, dumpId, MESSAGES.retry);
    }

    // 3. Into this learner's pool (unless it's already there), and the dump is done.
    const user = await db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, dump.userId) });
    await tx([
      db
        .insert(userWords)
        .values({
          ...NEW_WORD,
          userId: dump.userId,
          wordId: word.id,
          dueOn: todayIn(user?.timezone ?? "UTC"),
          origin: "dump",
          sourceDumpId: dump.id,
          createdAt: Date.now(),
        })
        .onConflictDoNothing({ target: [userWords.userId, userWords.wordId] }),
      db.update(dumps).set({ status: "committed", error: null }).where(eq(dumps.id, dumpId)),
    ]);
  } catch (err) {
    console.error("enrichment failed", dumpId, err);
    await fail(ctx, dumpId, err instanceof AiError && !err.retryable ? MESSAGES.unclear : MESSAGES.retry);
  }
}
