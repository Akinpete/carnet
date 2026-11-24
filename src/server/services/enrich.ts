// Looking words up: the shared `words` cache first, then the model. Three
// callers: a typed single word (one call), extraction (one batched call for
// the words not cached yet) and a learner correcting a misread word.
import { and, eq, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { z } from "zod";
import { POS, words } from "../../db/schema.sqlite.ts";
import type { Ctx } from "../ctx.ts";
import { newId } from "../ids.ts";

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

/** The same dictionary rules, for a list of entries extraction already lemmatised. */
export const ENRICH_BATCH_SYSTEM = `You are a French lexicographer helping an English-speaking beginner.
You get French dictionary entries, one per line as "lemma (pos)". Reply with JSON only: {"entries": [...]}, one entry per line, in the same order, each with exactly these keys:

"lemma": as given. "pos": as given.
"gender": "m" or "f" for nouns, otherwise null.
"translation": the most common modern English meaning, short. Verbs start with "to"; nouns start with "the". At most two senses, separated by " · ".
"gloss": one short extra sense or nuance in English, or null. Usually null.
"usageNote": null for almost every word. Write a note ONLY for a false friend: a word that looks like an English word but means something DIFFERENT (actuellement is not "actually", la librairie is not "the library", la grève is not "grief"), or a word easily confused with a similar French word. If the English look-alike means the same thing (l'adresse, la table, réserver), the note is null. Never write a note that says the word means what it looks like. A loose resemblance in spelling is not a trap either (le courriel and \"current\", l'étagère and \"stage\", la perceuse and \"perceive\"): the look-alike must be a real English word a learner would actually guess.
"distractors": exactly three WRONG English meanings for a multiple-choice question: tempting for an English speaker (the English look-alike when it's a false friend, meanings of similar French words) but clearly wrong. All different, none a meaning or synonym of the word.

Example. For the lines
la grève (noun)
l'adresse (noun)
{"entries":[{"lemma":"la grève","pos":"noun","gender":"f","translation":"the strike","gloss":"rarely, a shore or riverbank","usageNote":"It looks like \\"grief\\", but it almost always means a strike.","distractors":["the grief","the grave","the gravel"]},{"lemma":"l'adresse","pos":"noun","gender":"f","translation":"the address","gloss":"also skill, dexterity","usageNote":null,"distractors":["the dress","the arrest","the advice"]}]}`;

/**
 * Words per enrichment call. The calls run in parallel, so a dump's lookup
 * takes as long as one small batch, not one long one. Owner's call
 * (2026-11-24), replacing "one call per dump": measured on Mistral Small
 * 3.1, 12 words took ≈ 12 s in one call and ≈ 4–5 s as parallel batches.
 */
export const ENRICH_BATCH_SIZE = 3;

/** A month: a definition doesn't change, so identical lookups hit the gateway cache. */
const CACHE_TTL = 30 * 24 * 60 * 60;

/** Models sometimes send "" where null is meant. */
export const orNull = <T extends z.ZodType>(schema: T) =>
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

const entryFields = {
  lemma: orNull(z.string().max(80)),
  pos: orNull(z.enum(POS)),
  gender: orNull(z.enum(["m", "f"])),
  translation: orNull(z.string().max(120)),
  gloss: orNull(z.string().max(160)),
  usageNote: orNull(z.string().max(300)),
  distractors: z.array(z.string().max(120)).nullish(),
};

const entry = z.object(entryFields);
type Entry = z.infer<typeof entry>;

export const enrichReply = z.object({ kind: z.enum(["word", "sentence", "not_french", "unclear"]), ...entryFields });

/** Entries are checked one by one, so a single malformed entry doesn't sink the rest. */
export const enrichBatchReply = z.object({ entries: z.array(z.unknown()).max(40) });

export type Item = { lemma: string; pos: (typeof POS)[number] };

export const itemKey = (i: Item) => `${i.pos}:${i.lemma}`;

type Complete = Entry & Item & { translation: string };

const isComplete = (e: Entry): e is Complete => Boolean(e.lemma?.trim() && e.pos && e.translation?.trim());

/** Idempotent on (lemma, pos): the first definition wins and is shared. */
function insertWord(ctx: Ctx, e: Complete) {
  return ctx.db
    .insert(words)
    .values({
      id: newId("wrd"),
      lemma: e.lemma.trim(),
      pos: e.pos,
      gender: e.pos === "noun" ? (e.gender ?? null) : null,
      translation: e.translation.trim(),
      gloss: e.gloss?.trim() || null,
      usageNote: e.usageNote?.trim() || null,
      distractors: cleanDistractors(e.distractors ?? [], e.translation),
      createdAt: Date.now(),
    })
    .onConflictDoNothing({ target: [words.lemma, words.pos] });
}

/** The ids of whichever of these entries exist in `words`, by `itemKey`. */
async function findWords(ctx: Ctx, items: readonly Item[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (items.length === 0) return found;
  const lemmas = [...new Set(items.map((i) => i.lemma))];
  const rows = await ctx.db
    .select({ id: words.id, lemma: words.lemma, pos: words.pos })
    .from(words)
    .where(inArray(words.lemma, lemmas))
    .all();
  const wanted = new Set(items.map(itemKey));
  for (const r of rows) if (wanted.has(itemKey(r))) found.set(itemKey(r), r.id);
  return found;
}

export type LookUp =
  | { ok: true; wordId: string }
  | { ok: false; reason: "sentence" | "not_french" | "unclear" | "no_ai" | "retry" };

/** Exact matches in the shared cache: what was typed, or it with an article. */
function cacheCandidates(text: string): string[] {
  const t = text.trim().toLowerCase();
  const withArticles = /^[aeiouhâàéèêëîïôûü]/.test(t) ? [`l'${t}`] : [`le ${t}`, `la ${t}`];
  return [t, ...withArticles];
}

/** One typed word or phrase → its `words` row. Throws `AiError` when the model fails. */
export async function lookUpOne(ctx: Ctx, input: string): Promise<LookUp> {
  const { db, ai } = ctx;
  // "Grève." as Whisper writes it, or a typed full stop: look up the word.
  const text = input.trim().replace(/[.!?…]+$/, "").trim();
  // A word any learner has already looked up costs nothing.
  const cached = await db
    .select({ id: words.id })
    .from(words)
    .where(inArray(words.lemma, cacheCandidates(text)))
    .limit(2)
    .all();
  if (cached.length === 1 && cached[0]) return { ok: true, wordId: cached[0].id };

  if (!ai) return { ok: false, reason: "no_ai" };
  const reply = await ai.chat({
    route: "enrich",
    system: ENRICH_SYSTEM,
    user: text,
    schema: enrichReply,
    cacheTtlSeconds: CACHE_TTL,
    maxTokens: 400,
  });
  if (reply.kind !== "word") return { ok: false, reason: reply.kind };
  if (!isComplete(reply)) return { ok: false, reason: "unclear" };

  await insertWord(ctx, reply);
  const lemma = reply.lemma.trim();
  const row = await db
    .select({ id: words.id })
    .from(words)
    .where(and(eq(words.lemma, lemma), eq(words.pos, reply.pos)))
    .get();
  return row ? { ok: true, wordId: row.id } : { ok: false, reason: "retry" };
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Already-lemmatised entries → their `words` ids, by `itemKey`. Cached ones
 * are free; the rest go to the model in parallel batches of `ENRICH_BATCH_SIZE`.
 * Entries the model drops or garbles are left out rather than failing the
 * dump. Throws `AiError` only if every batch failed.
 */
export async function enrichMany(ctx: Ctx, items: readonly Item[]): Promise<Map<string, string>> {
  const found = await findWords(ctx, items);
  const misses = items.filter((i) => !found.has(itemKey(i)));
  if (misses.length === 0 || !ctx.ai) return found;
  const ai = ctx.ai;

  const batches = chunk(misses, ENRICH_BATCH_SIZE);
  const results = await Promise.allSettled(
    batches.map((batch) =>
      ai.chat({
        route: "enrich",
        system: ENRICH_BATCH_SYSTEM,
        user: batch.map((i) => `${i.lemma} (${i.pos})`).join("\n"),
        schema: enrichBatchReply,
        cacheTtlSeconds: CACHE_TTL,
        maxTokens: 120 * batch.length + 200,
        timeoutMs: 10_000,
      }),
    ),
  );

  const fresh: Complete[] = [];
  results.forEach((result, b) => {
    if (result.status !== "fulfilled") return;
    const batch = batches[b] ?? [];
    const wanted = new Map(batch.map((i) => [itemKey(i), i]));
    result.value.entries.forEach((raw, position) => {
      const parsed = entry.safeParse(raw);
      if (!parsed.success || !isComplete(parsed.data)) return;
      // Trust the line we asked about, not the model's echo of it. Fall back
      // to position when the model "corrected" the lemma.
      const echoed = wanted.get(itemKey({ lemma: parsed.data.lemma.trim(), pos: parsed.data.pos }));
      const asked = echoed ?? (result.value.entries.length === batch.length ? batch[position] : undefined);
      if (!asked) return;
      wanted.delete(itemKey(asked));
      fresh.push({ ...parsed.data, lemma: asked.lemma, pos: asked.pos });
    });
  });

  if (fresh.length === 0) {
    const failure = results.find((r) => r.status === "rejected");
    if (failure && results.every((r) => r.status === "rejected")) throw failure.reason;
    return found;
  }

  const [first, ...rest] = fresh.map((e) => insertWord(ctx, e));
  if (first) await ctx.tx([first, ...rest] as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  for (const [key, id] of await findWords(ctx, fresh)) found.set(key, id);
  return found;
}
