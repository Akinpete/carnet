import { describe, expect, it } from "vitest";
import { gradeLocally, normalise, type RecallCard, type RecognitionCard } from "./cards.ts";

const recall = (answer: string): RecallCard => ({
  wordId: "w",
  pos: "noun",
  gender: "f",
  rung: 2,
  type: "recall",
  prompt: "the strike",
  gloss: null,
  answer,
});

describe("normalise", () => {
  it("drops case, extra spaces, curly apostrophes and a leading article", () => {
    expect(normalise("  La   Grève ")).toBe("grève");
    expect(normalise("L’hôtel")).toBe("hôtel");
    expect(normalise("s’éloigner")).toBe("s'éloigner");
  });
});

describe("gradeLocally", () => {
  it("accepts an exact recall answer, with or without the article", () => {
    expect(gradeLocally(recall("la grève"), { text: "grève" })).toEqual({ correct: true, expected: "la grève", accentSlip: false });
    expect(gradeLocally(recall("la grève"), { text: "la grève" }).correct).toBe(true);
  });

  it("passes a missing or wrong accent, flagged", () => {
    expect(gradeLocally(recall("la grève"), { text: "greve" })).toMatchObject({ correct: true, accentSlip: true });
    expect(gradeLocally(recall("la grève"), { text: "grêve" })).toMatchObject({ correct: true, accentSlip: true });
  });

  it("rejects a different word, an empty answer and 'I don't know'", () => {
    expect(gradeLocally(recall("la grève"), { text: "grave" }).correct).toBe(false);
    expect(gradeLocally(recall("la grève"), { text: "   " }).correct).toBe(false);
    expect(gradeLocally(recall("la grève"), { dontKnow: true }).correct).toBe(false);
  });

  it("grades recognition by the chosen index", () => {
    const card: RecognitionCard = {
      wordId: "w",
      pos: "noun",
      gender: "f",
      rung: 1,
      type: "recognition",
      prompt: "la grève",
      choices: ["the grief", "the strike"],
      answerIndex: 1,
    };
    expect(gradeLocally(card, { choice: 1 })).toEqual({ correct: true, expected: "the strike", accentSlip: false });
    expect(gradeLocally(card, { choice: 0 }).correct).toBe(false);
  });
});
