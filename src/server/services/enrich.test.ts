// Cases taken from real Mistral Small 3.1 replies during model selection (2026-11-22).
import { describe, expect, it } from "vitest";
import { cleanDistractors, enrichReply } from "./enrich.ts";

describe("cleanDistractors", () => {
  it("drops distractors that are the word's own meaning, and duplicates", () => {
    // actuellement → translation "currently · now", distractors ["actually","currently","currently"]
    expect(cleanDistractors(["actually", "currently", "currently"], "currently · now")).toEqual(["actually"]);
    // éventuellement → ["eventually","eventually","event"]
    expect(cleanDistractors(["eventually", "eventually", "event"], "possibly · maybe")).toEqual(["eventually", "event"]);
  });

  it("compares without the leading article or 'to'", () => {
    expect(cleanDistractors(["The Strike", "the grief", "the grave"], "the strike")).toEqual(["the grief", "the grave"]);
    expect(cleanDistractors(["to watch", "to regard"], "to look at · to watch")).toEqual(["to regard"]);
  });

  it("keeps good ones as they are, at most three", () => {
    expect(cleanDistractors(["the library", "the freedom", "the liberty", "the libra"], "the bookstore")).toEqual([
      "the library",
      "the freedom",
      "the liberty",
    ]);
    expect(cleanDistractors(["", "  "], "the window")).toEqual([]);
  });
});

describe("enrichReply", () => {
  it("accepts empty strings where null is meant (the non-word replies)", () => {
    const reply = enrichReply.parse({
      kind: "not_french",
      lemma: "",
      pos: "",
      gender: null,
      translation: "",
      gloss: null,
      usageNote: null,
      distractors: ["", "", ""],
    });
    expect(reply).toMatchObject({ kind: "not_french", lemma: null, pos: null, translation: null });
  });

  it("accepts a reply that leaves out gender for non-nouns", () => {
    const reply = enrichReply.parse({
      kind: "word",
      lemma: "actuellement",
      pos: "adv",
      translation: "currently · now",
      gloss: null,
      usageNote: "",
      distractors: ["actually"],
    });
    expect(reply).toMatchObject({ pos: "adv", usageNote: null });
    expect(reply.gender ?? null).toBeNull();
  });
});
