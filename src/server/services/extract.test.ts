import { describe, expect, it } from "vitest";
import { findSentence, looksLikeOneItem, splitSentences } from "./extract.ts";

describe("looksLikeOneItem", () => {
  it("takes words and short phrases as one item", () => {
    for (const t of ["grève", "la grève.", "avoir l'air", "en avoir marre", "il y a"]) expect(looksLikeOneItem(t)).toBe(true);
  });

  it("sends sentences and longer text to extraction", () => {
    for (const t of ["Le patron m'a retrouvé une table", "Il pleut. Je reste.", "oui; non", "une\nfenêtre"]) {
      expect(looksLikeOneItem(t)).toBe(false);
    }
  });
});

describe("findSentence", () => {
  const text = "Le patron m'a retrouvé une table. Elle était déjà occupée !\nOn est partis.";
  const sentences = splitSentences(text);

  it("splits on sentence ends and line breaks", () => {
    expect(sentences).toEqual(["Le patron m'a retrouvé une table.", "Elle était déjà occupée !", "On est partis."]);
  });

  it("finds the sentence by the form met, or else by the lemma, ignoring accents and case", () => {
    expect(findSentence(sentences, "occupée", "occupé")).toBe("Elle était déjà occupée !");
    expect(findSentence(sentences, null, "le patron")).toBe("Le patron m'a retrouvé une table.");
    expect(findSentence(sentences, "RETROUVE", "retrouver")).toBe("Le patron m'a retrouvé une table.");
    expect(findSentence(sentences, "absent", "le mot")).toBeNull();
  });

  it("falls back to content words and stems when the model reports the dictionary form", () => {
    const met = splitSentences("J'en avais marre d'attendre. Je me suis rendu compte qu'il valait mieux partir.");
    expect(findSentence(met, "avoir marre", "en avoir marre")).toBe("J'en avais marre d'attendre.");
    expect(findSentence(met, "rendre compte", "se rendre compte")).toBe("Je me suis rendu compte qu'il valait mieux partir.");
    expect(findSentence(met, "valoir", "valoir")).toBe("Je me suis rendu compte qu'il valait mieux partir.");
    // Auxiliaries alone never match: "avoir" mustn't find "avais".
    expect(findSentence(["Il avait faim."], "avoir", "avoir")).toBeNull();
  });

  it("cuts a long sentence down to the part around the word", () => {
    const long = `${"Avant cela il y avait beaucoup de choses à dire ".repeat(4)}sur la grève ${"et puis encore beaucoup d'autres choses ".repeat(4)}`.trim();
    const found = findSentence([long], "grève", "la grève") ?? "";
    expect(found).toContain("la grève");
    expect(found.startsWith("…")).toBe(true);
    expect(found.endsWith("…")).toBe(true);
    expect(found.length).toBeLessThan(long.length);
  });
});
