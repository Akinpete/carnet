// Open-form grading (BACKEND.md, Grading): the model judges meaning, then
// names the failure. Rung 3 asks what a word means in a sentence the learner
// met. Rung 4 asks for a sentence of their own; there the model only
// describes what it sees and the verdict is decided here, in code, because a
// small model asked to weigh everything at once was inconsistent (measured
// 2026-11-25: gender slips failed, false friends passed).
import { z } from "zod";
import type { ComprehensionCard, ProductionCard } from "../../shared/cards.ts";
import type { Ctx } from "../ctx.ts";
import { orNull } from "./enrich.ts";
import type { Grade } from "./scheduler.ts";

export const GRADE_SYSTEM = `You check whether an English-speaking beginner understood a French word in a sentence. You get JSON: the sentence, the word as it appears there ("form"), its dictionary form ("lemma"), its usual meaning ("meaning"), and the learner's answer in English. Reply with JSON only:

{"verdict": ..., "errorKind": ..., "meaning": ..., "explanation": ...}

"verdict": "right" if the answer gives what the word means in THIS sentence: a synonym, a looser paraphrase, a translation of the whole phrase, a different tense or form, or a spelling mistake all count as right. "close" if it points the right way but is off: a real sense of the word that doesn't fit this sentence (retrouver as "to meet" where something is found), or a shade too weak or too strong. "wrong" if they didn't understand it, including answers too vague to show understanding ("a problem", "a thing").
"errorKind": null when right or close. When wrong, exactly one of: "false_cognate" (they trusted an English word that looks like the French one: actuellement → "actually", le patron → "the customer", sensible → "sensible"), "confused_pair" (they gave the meaning of a similar French word), "unusable" (not an answer at all: random letters, an empty reply), "forgot" (anything else, including "I don't know").
"meaning": what the word means in this sentence, in a few English words, in the sentence's sense (not every dictionary sense).
"explanation": null when right. Otherwise one or two short sentences to the learner, second person, plain, no exclamation marks: say what in the sentence shows the meaning, or name the look-alike or similar word that misled them. Explain the mechanism, not a rule. Don't correct anything they didn't get wrong.
Judge meaning, never wording.`;

/** The closed set (BACKEND.md). Comprehension answers are English, so no grammar kinds here. */
export const ERROR_KINDS = ["forgot", "confused_pair", "false_cognate", "wrong_form", "wrong_tense", "unusable"] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

export const gradeReply = z.object({
  verdict: z.enum(["right", "close", "wrong"]),
  errorKind: orNull(z.enum(["forgot", "confused_pair", "false_cognate", "unusable"])),
  meaning: orNull(z.string().max(200)),
  explanation: orNull(z.string().max(600)),
});

export type Judgement = {
  /** Rung 4: their sentence with only the problem fixed. */
  corrected?: string | null;
  /** Rung 4: the word used correctly, with its English. */
  example?: { fr: string; en: string } | null;
  grade: Grade;
  correct: boolean;
  /** The pass that holds the rung instead of climbing it. */
  close: boolean;
  errorKind: ErrorKind | null;
  meaning: string;
  explanation: string | null;
};

/** right climbs a rung, close passes and holds it, wrong drops back to recall. */
const GRADES = { right: 3, close: 2, wrong: 0 } as const satisfies Record<string, Grade>;

export function judgementFrom(reply: z.infer<typeof gradeReply>, fallbackMeaning: string): Judgement {
  const wrong = reply.verdict === "wrong";
  return {
    grade: GRADES[reply.verdict],
    correct: !wrong,
    close: reply.verdict === "close",
    errorKind: wrong ? (reply.errorKind ?? "forgot") : null,
    meaning: reply.meaning?.trim() || fallbackMeaning,
    explanation: reply.verdict === "right" ? null : reply.explanation?.trim() || null,
  };
}

/** One model call. Throws `AiError`; the caller records nothing, so the card can be tried again. */
export async function gradeComprehension(
  ctx: Ctx & { ai: NonNullable<Ctx["ai"]> },
  card: ComprehensionCard,
  translation: string,
  answer: string,
): Promise<Judgement> {
  const reply = await ctx.ai.chat({
    route: "grade",
    system: GRADE_SYSTEM,
    user: JSON.stringify({ sentence: card.prompt, form: card.form ?? card.lemma, lemma: card.lemma, meaning: translation, answer }),
    schema: gradeReply,
    maxTokens: 300,
    timeoutMs: 12_000,
  });
  return judgementFrom(reply, translation);
}

export const PRODUCE_SYSTEM = `You look at a French sentence an English-speaking beginner said or typed to show they can use a word. You get JSON: the target word ("lemma"), its meaning, the task, and the learner's sentence ("answer"; it may come from speech recognition, so ignore punctuation and capitals). Describe what you see; don't grade. Reply with JSON only:

{"usesWord": ..., "meaningInSentence": ..., "sense": ..., "mixedUpWith": ..., "mistake": ..., "explanation": ..., "corrected": ..., "example": {"fr": ..., "en": ...}}

"usesWord": true if the target word appears in any form (conjugated, plural, feminine, with or without its article).
"meaningInSentence": in a few English words, what the target word means the way the learner used it.
"sense": compare meaningInSentence with the word's real meaning:
  "correct" — the learner used it in a meaning it really has.
  "english_lookalike" — they used it to mean an English word that looks or sounds like it (la librairie for "library", sensible for "sensible", éventuellement for "eventually").
  "similar_french_word" — they used it as if it were a different French word with a related meaning (savoir for connaître).
  "nonsense" — the sentence doesn't mean anything.
"mixedUpWith": the English or French word they confused it with, or null.
"mistake": the single most important grammar mistake in the sentence, or null if there is none worth mentioning. One of: "gender" (un/une, le/la), "agreement" (an extra or missing -e/-s), "preposition", "elision" (que il → qu'il), "conjugation" (a verb form that doesn't exist or doesn't match its subject), "pronoun" (a missing or wrong reflexive pronoun: je rends compte → je me rends compte), "tense" (the tense the task asked for wasn't used), "other".
"explanation": null if sense is "correct" and mistake is null. Otherwise one or two short sentences to the learner, second person, plain, no exclamation marks: if sense isn't "correct", explain what the word really means and what misled them; else explain the mistake's mechanism, not the rule's name.
"corrected": null if sense is "correct" and mistake is null; otherwise their sentence with only that problem fixed.
"example": a short, natural French sentence using the word correctly in its usual sense, with its English. Always include it.`;

const MISTAKES = ["gender", "agreement", "preposition", "elision", "conjugation", "pronoun", "tense", "other"] as const;

export const produceReply = z.object({
  usesWord: z.boolean(),
  meaningInSentence: orNull(z.string().max(200)),
  sense: z.enum(["correct", "english_lookalike", "similar_french_word", "nonsense"]),
  mixedUpWith: orNull(z.string().max(80)),
  mistake: orNull(z.enum(MISTAKES)),
  explanation: orNull(z.string().max(600)),
  corrected: orNull(z.string().max(400)),
  example: z.object({ fr: z.string().max(300), en: z.string().max(300) }).nullish(),
});

/**
 * The spec's rules, applied to the model's observations: meaning first, then
 * form. Slips in gender, agreement, prepositions or elision pass with a note
 * (meaning over form); a broken verb holds the rung as a grammar failure that
 * doesn't punish the word's schedule; the wrong word or sense fails.
 */
export function decideProduction(r: z.infer<typeof produceReply>, meaning: string): Judgement {
  const base = {
    meaning,
    explanation: r.explanation?.trim() || null,
    corrected: r.corrected?.trim() || null,
    example: r.example?.fr.trim() ? { fr: r.example.fr.trim(), en: r.example.en.trim() } : null,
  };
  const fail = (errorKind: ErrorKind): Judgement => ({ ...base, grade: 0, correct: false, close: false, errorKind });
  if (!r.usesWord) return fail("forgot");
  if (r.sense === "english_lookalike") return fail("false_cognate");
  if (r.sense === "similar_french_word") return fail("confused_pair");
  if (r.sense === "nonsense") return fail("unusable");
  if (r.mistake === "conjugation" || r.mistake === "pronoun") {
    return { ...base, grade: 1, correct: false, close: false, errorKind: "wrong_form" };
  }
  if (r.mistake === "tense") return { ...base, grade: 1, correct: false, close: false, errorKind: "wrong_tense" };
  if (r.mistake) return { ...base, grade: 2, correct: true, close: true, errorKind: null };
  return { ...base, explanation: null, corrected: null, grade: 3, correct: true, close: false, errorKind: null };
}

export async function gradeProduction(
  ctx: Ctx & { ai: NonNullable<Ctx["ai"]> },
  card: ProductionCard,
  answer: string,
): Promise<Judgement> {
  const reply = await ctx.ai.chat({
    route: "grade",
    system: PRODUCE_SYSTEM,
    user: JSON.stringify({ lemma: card.lemma, meaning: card.translation, task: "Use this word in a sentence of your own.", answer }),
    schema: produceReply,
    maxTokens: 450,
    timeoutMs: 12_000,
  });
  return decideProduction(reply, card.translation);
}
