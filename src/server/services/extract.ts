// A dump's path from text to the pool (BACKEND.md, Ingestion pipeline).
// One typed word or phrase goes straight in, as in M1. Longer text is
// extracted (one call); a screenshot is read and extracted in the same one
// call. Then the words not cached yet are looked up in small parallel
// batches, and the dump waits as candidates for the learner to keep or drop.
import { Buffer } from "node:buffer";
import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { z } from "zod";
import { dumpCandidates, dumps, POS, userWords } from "../../db/schema.sqlite.ts";
import { stripAccents } from "../../shared/cards.ts";
import { AiError } from "../ai.ts";
import type { Ctx } from "../ctx.ts";
import { todayIn } from "../lib/dates.ts";
import { enrichMany, itemKey, lookUpOne, orNull, type Item } from "./enrich.ts";
import { NEW_WORD } from "./scheduler.ts";

/** Most words a dump can offer: a session's worth of new words, twice over. */
export const MAX_CANDIDATES = 12;

const ITEM_RULES = `"form": the words copied character for character from the text, as written there, so they can be highlighted: conjugated, plural or feminine as they appear. For "il valait mieux" the form is "valait", not "valoir"; for "j'en avais marre" it is "en avais marre"; for "m'a retrouvé" it is just "retrouvé".
"lemma": the dictionary form. Verbs in the infinitive, keeping "se"/"s'" for pronominal verbs ("s'éloigner"). Nouns in the singular WITH the definite article: "la grève", "le patron", "l'hôtel". Adjectives in the masculine singular. Fixed expressions in their usual form ("avoir besoin de", "se rendre compte", "en avoir marre").
"pos": one of "noun", "verb", "adj", "adv", "pron", "other" (expressions are "other").

Rules:
- Keep a fixed expression as ONE item when its meaning isn't the sum of its words ("avoir beau", "se rendre compte", "il y a", "en fait"). Otherwise list single words.
- Skip articles, plain pronouns (je, il, elle, on), common prepositions and conjunctions (de, à, et, mais, que), names of people and places, numbers, and être / avoir used as auxiliaries.
- One item per lemma, in the order they first appear. At most ${MAX_CANDIDATES} items; if there are more, keep the most useful for a beginner.
- Correct obvious misspellings and missing accents in "lemma", never in "form".`;

export const EXTRACT_SYSTEM = `You are a French lexicographer helping an English-speaking beginner.
The learner met this French text and wants to learn from it. Pick out the words and fixed expressions worth learning, and reply with JSON only:

{"kind": "items", "items": [{"form": ..., "lemma": ..., "pos": ...}]}

"kind": "items" if the text is French; "not_french" if it isn't French (then "items" is []); "unclear" if you can't make sense of it (then "items" is []).
Each item:
${ITEM_RULES}`;

/** Reading and extracting in one call: a second call would cost seconds (measured 2026-11-24). */
export const EXTRACT_IMAGE_SYSTEM = `You are a French lexicographer helping an English-speaking beginner.
The learner took this screenshot because it has French in it they want to learn from. Reply with JSON only:

{"kind": "items", "text": ..., "items": [{"form": ..., "lemma": ..., "pos": ...}]}

"kind": "items" if there is French text; "not_french" if there is no French (then "text" is null and "items" is []); "unclear" if you can't read it (same).
"text": the French text, transcribed exactly, accents included, as running sentences. Leave out interface chrome: times, battery, buttons, menus, usernames, like counts.
Each item:
${ITEM_RULES}`;

export const extractReply = z.object({
  kind: z.enum(["items", "not_french", "unclear"]),
  /** Screenshots only: what the image says. */
  text: orNull(z.string().max(6000)),
  items: z.array(z.unknown()).nullish(),
});

const extractedItem = z.object({
  form: orNull(z.string().max(120)),
  lemma: z.string().trim().min(1).max(80),
  pos: z.enum(POS),
});

export const MESSAGES = {
  not_french: "That doesn't look like French.",
  unclear: "Couldn't make sense of that. Check the spelling?",
  unreadable: "Couldn't read any French in that image.",
  silent: "Couldn't hear any French in that recording. Try again a little closer.",
  not_a_page: "That link isn't a web page Carnet can read. Paste its text instead.",
  unreachable: "Couldn't reach that page. Check the link, or paste its text instead.",
  not_found: "That page doesn't exist any more.",
  blocked: "That site doesn't let Carnet in. Paste the article's text instead.",
  no_article: "Couldn't find an article on that page. Paste its text instead.",
  nothing: "Couldn't find any words worth learning in that.",
  no_ai: "Word lookup isn't set up on this server yet.",
  retry: "The lookup didn't finish. Try again in a moment.",
} as const;

/**
 * Whisper fills silence and music with stock phrases learned from subtitles.
 * Those are not something the learner heard.
 */
const HALLUCINATIONS = [
  /sous-titr/i,
  /amara\.org/i,
  /merci d'avoir regardé/i,
  /abonnez-vous/i,
  /^(merci|thank you|you|bye)[.!]*$/i,
];

export function cleanTranscript(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "";
  const kept = splitSentences(t).filter((s) => !HALLUCINATIONS.some((h) => h.test(s.trim())));
  return kept.join(" ").trim();
}

/** Up to four words and no sentence punctuation: treat it as one word or phrase. */
export function looksLikeOneItem(text: string): boolean {
  const t = text.trim().replace(/[.!?…]+$/, "");
  return t.split(/\s+/).length <= 4 && !/[.!?;:…\n]/.test(t);
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…»])\s+|\n+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const fold = (s: string) => stripAccents(s.toLowerCase().replace(/[’‘]/g, "'"));
const LONG = 200;

/** Words not worth searching for alone, folded: articles, pronouns, auxiliaries. */
const FILLER = new Set(["avoir", "etre", "faire", "se", "en", "le", "la", "les", "de", "un", "une", "des"]);

/** The start of a word that survives conjugation: "valoir" → "val", "occupé" → "occup". */
const stem = (word: string) => word.slice(0, Math.max(3, word.length - 3));

/**
 * The sentence a word was met in, cut to a window around it when long. Looks
 * for the form as written, then the lemma, then any of their content words,
 * then those words' stems, since models sometimes report the dictionary form.
 */
export function findSentence(sentences: readonly string[], form: string | null | undefined, lemma: string): string | null {
  const whole = [form, lemma.replace(/^(le |la |les |l'|se |s')/i, "")]
    .filter((n): n is string => Boolean(n?.trim()))
    .map((n) => fold(n.trim()));
  const parts = [...new Set(whole.flatMap((n) => n.split(/[\s']+/)))].filter((w) => w.length >= 3 && !FILLER.has(w));
  const tries: ((s: string) => number)[] = [
    ...whole.map((n) => (s: string) => s.indexOf(n)),
    ...parts.map((w) => (s: string) => s.search(new RegExp(`(?<![\\p{L}])${escape(w)}(?![\\p{L}])`, "u"))),
    ...parts.map((w) => (s: string) => s.search(new RegExp(`(?<![\\p{L}])${escape(stem(w))}`, "u"))),
  ];
  for (const at of tries) {
    for (const sentence of sentences) {
      const i = at(fold(sentence));
      if (i !== -1) return around(sentence, i);
    }
  }
  return null;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function around(sentence: string, at: number): string {
  if (sentence.length <= LONG) return sentence;
  const start = Math.max(0, sentence.lastIndexOf(" ", Math.max(0, at - 80)));
  const endAt = sentence.indexOf(" ", Math.min(sentence.length, at + 100));
  const end = endAt === -1 ? sentence.length : endAt;
  return `${start > 0 ? "…" : ""}${sentence.slice(start, end).trim()}${end < sentence.length ? "…" : ""}`;
}

type DumpRow = typeof dumps.$inferSelect;
type Write = BatchItem<"sqlite">;

async function fail(ctx: Ctx, dumpId: string, message: string) {
  await ctx.db.update(dumps).set({ status: "failed", error: message }).where(eq(dumps.id, dumpId));
}

/** The writes that put words in a learner's pool from a dump. Words already there are left alone. */
export async function poolWrites(ctx: Ctx, dump: Pick<DumpRow, "id" | "userId">, wordIds: readonly string[]): Promise<Write[]> {
  const user = await ctx.db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, dump.userId) });
  const dueOn = todayIn(user?.timezone ?? "UTC");
  return wordIds.map((wordId) =>
    ctx.db
      .insert(userWords)
      .values({ ...NEW_WORD, userId: dump.userId, wordId, dueOn, origin: "dump", sourceDumpId: dump.id, createdAt: Date.now() })
      .onConflictDoNothing({ target: [userWords.userId, userWords.wordId] }),
  );
}

const run = (ctx: Ctx, writes: Write[]) => ctx.tx(writes as [Write, ...Write[]]);

/** Per extraction attempt. Two attempts and the lookups stay inside Workers' 30 s for deferred work. */
const EXTRACT_TIMEOUT_MS = 12_000;

/** An upload handed straight to extraction, from memory. */
export type Upload = { bytes: Uint8Array; mediaType: string };

/** Runs in `defer` after POST /dumps returns. Never throws: failures land on the dump. */
export async function processDump(ctx: Ctx, dumpId: string, upload?: Upload): Promise<void> {
  const { db, ai } = ctx;
  const dump = await db.select().from(dumps).where(eq(dumps.id, dumpId)).get();
  if (!dump || dump.status !== "extracting") return;
  const isLink = dump.kind === "url";
  const image = dump.kind === "image" ? upload : undefined;
  const audio = dump.kind === "audio" ? upload : undefined;
  if ((dump.kind === "image" || dump.kind === "audio") && !upload) return;
  if (dump.kind === "text" && !dump.rawText) return;

  try {
    let text = dump.rawText ?? "";

    // 0. A link: fetch the page and keep the opening of its article.
    if (isLink) {
      const read = await ctx.web.readArticle(dump.sourceRef ?? "");
      if (!read.ok) return fail(ctx, dumpId, MESSAGES[read.reason]);
      text = read.article.text;
    }

    // 0. A voice note: transcribe it, then treat it as text. The recording isn't kept.
    if (audio) {
      if (!ai) return fail(ctx, dumpId, MESSAGES.no_ai);
      const heard = await ai.transcribe({ route: "transcribe", audio: audio.bytes, mediaType: audio.mediaType, language: "fr" });
      text = cleanTranscript(heard.text);
      if (!text) return fail(ctx, dumpId, MESSAGES.silent);
      await db.update(dumps).set({ rawText: text }).where(eq(dumps.id, dumpId));
    }

    // 1. One typed or spoken word or phrase: straight into the pool, no review (M1's path).
    if (!image && !isLink && looksLikeOneItem(text)) {
      const found = await lookUpOne(ctx, text);
      if (found.ok) {
        const done = db.update(dumps).set({ status: "committed", error: null }).where(eq(dumps.id, dumpId));
        return void (await run(ctx, [...(await poolWrites(ctx, dump, [found.wordId])), done]));
      }
      // The model saw a sentence after all: extract it like one.
      if (found.reason !== "sentence") return fail(ctx, dumpId, MESSAGES[found.reason]);
    }

    // 2. Pick out the words worth learning (and, for a screenshot, read it first, in the same call).
    if (!ai) return fail(ctx, dumpId, MESSAGES.no_ai);
    const request = {
      route: "extract" as const,
      system: image ? EXTRACT_IMAGE_SYSTEM : EXTRACT_SYSTEM,
      user: image ? "Here is the screenshot." : text,
      image: image ? { mediaType: image.mediaType, base64: Buffer.from(image.bytes).toString("base64") } : undefined,
      schema: extractReply,
      maxTokens: image ? 1400 : 900,
      timeoutMs: EXTRACT_TIMEOUT_MS,
    };
    // Usually 5–8 s; now and then the model stalls. One retry still fits the 30 s budget.
    const reply = await ai.chat(request).catch((err: unknown) => {
      if (err instanceof AiError && err.retryable) return ai.chat(request);
      throw err;
    });
    if (reply.kind !== "items") return fail(ctx, dumpId, image ? MESSAGES.unreadable : MESSAGES[reply.kind]);
    if (image) text = reply.text?.trim() ?? "";

    const items: (Item & { form: string | null })[] = [];
    const seen = new Set<string>();
    for (const raw of reply.items ?? []) {
      const parsed = extractedItem.safeParse(raw);
      if (!parsed.success || seen.has(itemKey(parsed.data))) continue;
      seen.add(itemKey(parsed.data));
      items.push({ lemma: parsed.data.lemma, pos: parsed.data.pos, form: parsed.data.form?.trim() || null });
    }
    if (items.length === 0) return fail(ctx, dumpId, MESSAGES.nothing);
    items.splice(MAX_CANDIDATES);

    // 3. Look them up: cached words are free, the rest go out in parallel batches.
    const ids = await enrichMany(ctx, items);
    const sentences = splitSentences(text);
    const taken = new Set<string>();
    const candidates = items.flatMap((item) => {
      const wordId = ids.get(itemKey(item));
      if (!wordId || taken.has(wordId)) return [];
      taken.add(wordId);
      return [{ dumpId, wordId, form: item.form, sentence: findSentence(sentences, item.form, item.lemma), position: taken.size - 1 }];
    });
    if (candidates.length === 0) return fail(ctx, dumpId, MESSAGES.retry);

    // 4. Waiting for review, or straight in when there's only one word to keep.
    const writes: Write[] = candidates.map((c) => db.insert(dumpCandidates).values(c).onConflictDoNothing());
    const read = image || isLink || audio ? { rawText: text } : {};
    if (candidates.length === 1 && candidates[0]) {
      writes.push(...(await poolWrites(ctx, dump, [candidates[0].wordId])));
      writes.push(db.update(dumps).set({ ...read, status: "committed", error: null }).where(eq(dumps.id, dumpId)));
    } else {
      writes.push(db.update(dumps).set({ ...read, status: "awaiting_review", error: null }).where(eq(dumps.id, dumpId)));
    }
    await run(ctx, writes);
  } catch (err) {
    console.error("extraction failed", dumpId, err);
    await fail(ctx, dumpId, err instanceof AiError && !err.retryable ? MESSAGES.unclear : MESSAGES.retry);
  }
}
