// Card shapes and local grading, shared by the server (authoritative) and the
// app (instant feedback). Rungs 1–2 are closed-form: no model call. Rung 3
// and up are judged by the model, on the server only.

type CardBase = {
  wordId: string;
  pos: string;
  gender: "m" | "f" | null;
  /** The trap worth knowing, shown only after answering. Absent on cards stored before it existed. */
  usageNote?: string | null;
};

/** Rung 1: here is the French — what does it mean? */
export type RecognitionCard = CardBase & {
  rung: 1;
  type: "recognition";
  prompt: string; // the French, e.g. "la grève"
  choices: string[];
  answerIndex: number;
};

/** Rung 2: here is the English — produce the French. */
export type RecallCard = CardBase & {
  rung: 2;
  type: "recall";
  prompt: string; // the English
  gloss: string | null;
  answer: string; // the French lemma
};

/** Rung 3: here is the word in a sentence you met it in — what does it mean here? */
export type ComprehensionCard = CardBase & {
  rung: 3;
  type: "comprehension";
  prompt: string; // the French sentence
  /** The word as it appears in the sentence, to highlight. */
  form: string | null;
  lemma: string;
  /** Where the sentence came from: the learner's own dump, or a generated example. */
  source: "dump" | "example";
};

export type Card = RecognitionCard | RecallCard | ComprehensionCard;

/** The cards the device can grade by itself. */
export type LocalCard = RecognitionCard | RecallCard;

export const isLocal = (card: Card): card is LocalCard => card.type === "recognition" || card.type === "recall";

/** Highest rung with a card type built so far. M3 raises it to 5. */
export const MAX_RUNG = 3;

export type LocalAnswer = { choice: number } | { text: string } | { dontKnow: true };

export type LocalResult = {
  correct: boolean;
  /** The right answer, for display. */
  expected: string;
  /** Right apart from accents: still correct, but show the spelling. */
  accentSlip: boolean;
};

const ARTICLE = /^(le|la|les|l'|un|une|des)\s*/;

/** Lower case, straight apostrophes, single spaces, no leading article. */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFC")
    .replace(/[’‘`´]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .replace(ARTICLE, "")
    .trim();
}

export function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").normalize("NFC");
}

export function gradeLocally(card: LocalCard, answer: LocalAnswer): LocalResult {
  if (card.type === "recognition") {
    const expected = card.choices[card.answerIndex] ?? "";
    const correct = "choice" in answer && answer.choice === card.answerIndex;
    return { correct, expected, accentSlip: false };
  }
  if (!("text" in answer)) return { correct: false, expected: card.answer, accentSlip: false };
  const given = normalise(answer.text);
  const target = normalise(card.answer);
  if (given.length === 0) return { correct: false, expected: card.answer, accentSlip: false };
  if (given === target) return { correct: true, expected: card.answer, accentSlip: false };
  const slip = stripAccents(given) === stripAccents(target);
  return { correct: slip, expected: card.answer, accentSlip: slip };
}
