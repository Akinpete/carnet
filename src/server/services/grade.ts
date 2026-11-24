// Open-form grading (BACKEND.md, Grading): the model judges meaning, then
// names the failure. Rung 3 asks what a word means in a sentence the learner
// met; rungs 4–5 (M3) will reuse the call shape for spoken sentences.
import { z } from "zod";
import type { ComprehensionCard } from "../../shared/cards.ts";
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
