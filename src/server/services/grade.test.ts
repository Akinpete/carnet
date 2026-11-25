// The rung 4 verdict is decided here from the model's observations, so the
// spec's rules are testable without a model.
import { describe, expect, it } from "vitest";
import { decideProduction, judgementFrom } from "./grade.ts";

const seen = (over: Partial<Parameters<typeof decideProduction>[0]> = {}) => ({
  usesWord: true,
  meaningInSentence: "to find again",
  sense: "correct" as const,
  mixedUpWith: null,
  mistake: null,
  explanation: "Why.",
  corrected: "Fixed.",
  example: { fr: "J'ai retrouvé mes clés.", en: "I found my keys." },
  ...over,
});

describe("decideProduction", () => {
  it("passes a clean sentence and drops the fix it doesn't need", () => {
    expect(decideProduction(seen(), "to find again")).toMatchObject({ grade: 3, correct: true, close: false, errorKind: null, explanation: null, corrected: null });
  });

  it("passes slips in gender, agreement, prepositions and elision with a note (meaning over form)", () => {
    for (const mistake of ["gender", "agreement", "preposition", "elision", "other"] as const) {
      expect(decideProduction(seen({ mistake }), "x")).toMatchObject({ grade: 2, correct: true, close: true, errorKind: null, corrected: "Fixed." });
    }
  });

  it("holds the rung for a broken verb or a missed tense: grammar, not vocabulary", () => {
    expect(decideProduction(seen({ mistake: "conjugation" }), "x")).toMatchObject({ grade: 1, correct: false, errorKind: "wrong_form" });
    expect(decideProduction(seen({ mistake: "pronoun" }), "x")).toMatchObject({ grade: 1, errorKind: "wrong_form" });
    expect(decideProduction(seen({ mistake: "tense" }), "x")).toMatchObject({ grade: 1, errorKind: "wrong_tense" });
  });

  it("fails the wrong word or the wrong sense, whatever the grammar", () => {
    expect(decideProduction(seen({ usesWord: false }), "x")).toMatchObject({ grade: 0, errorKind: "forgot" });
    expect(decideProduction(seen({ sense: "english_lookalike", mistake: "gender" }), "x")).toMatchObject({ grade: 0, errorKind: "false_cognate" });
    expect(decideProduction(seen({ sense: "similar_french_word" }), "x")).toMatchObject({ grade: 0, errorKind: "confused_pair" });
    expect(decideProduction(seen({ sense: "nonsense" }), "x")).toMatchObject({ grade: 0, errorKind: "unusable" });
  });
});

describe("judgementFrom (rung 3)", () => {
  it("maps right / close / wrong to 3 / 2 / 0, and a wrong without a kind to forgot", () => {
    expect(judgementFrom({ verdict: "right", errorKind: null, meaning: "found", explanation: "x" }, "f")).toMatchObject({ grade: 3, explanation: null });
    expect(judgementFrom({ verdict: "close", errorKind: null, meaning: null, explanation: "x" }, "f")).toMatchObject({ grade: 2, close: true, meaning: "f" });
    expect(judgementFrom({ verdict: "wrong", errorKind: null, meaning: "m", explanation: "x" }, "f")).toMatchObject({ grade: 0, errorKind: "forgot" });
  });
});
