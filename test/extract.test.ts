// M2: longer text → extraction → review → only the ticked words reach the pool.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { DumpDetail, DumpView, TodayView } from "../src/shared/types.ts";
import { extracted, fakeAi, FENETRE, GREVE, newLearner, OCCUPE, PATRON, RETROUVER, type Client } from "./helpers.ts";

const json = async <T>(res: Response) => (await res.json()) as T;

const TEXT = "Le patron du café m'a retrouvé une table près de la fenêtre, mais elle était déjà occupée.";
const FOUND = extracted(
  { form: "patron", lemma: "le patron", pos: "noun" },
  { form: "retrouvé", lemma: "retrouver", pos: "verb" },
  { form: "fenêtre", lemma: "la fenêtre", pos: "noun" },
  { form: "occupée", lemma: "occupé", pos: "adj" },
);
const OCCUPER = { ...OCCUPE, lemma: "occuper", pos: "verb", translation: "to occupy" };

async function dumpText(me: Client, text: string): Promise<DumpDetail> {
  const { dump } = await json<{ dump: DumpView }>(await me.call("/dumps", { body: { text } }));
  return (await json<{ dump: DumpDetail }>(await me.call(`/dumps/${dump.id}`))).dump;
}

const poolSize = async (me: Client) => (await json<TodayView>(await me.call("/sessions/today"))).total;

describe("pasting a sentence", () => {
  it("offers the words in it for review, with the sentence, and touches nothing in the pool", async () => {
    const ai = fakeAi({ fenêtre: FENETRE, patron: PATRON, retrouver: RETROUVER, occupé: OCCUPE }, { [TEXT]: FOUND });
    const me = await newLearner(ai);
    await me.call("/dumps", { body: { text: "fenêtre" } }); // already in the pool, and in the shared cache

    const dump = await dumpText(me, TEXT);
    expect(dump.status).toBe("awaiting_review");
    expect(dump.found).toEqual({ total: 4, fresh: 3 });
    expect(dump.kept).toBe(0);
    expect(dump.candidates.map((c) => [c.lemma, c.form, c.known])).toEqual([
      ["le patron", "patron", false],
      ["retrouver", "retrouvé", false],
      ["la fenêtre", "fenêtre", true],
      ["occupé", "occupée", false],
    ]);
    expect(dump.candidates.every((c) => c.sentence === TEXT)).toBe(true);
    expect(dump.candidates[0]).toMatchObject({ translation: "the boss · the owner", gender: "m" });

    // One extraction call, then one lookup for only the words nobody has looked up yet.
    expect(ai.routes).toEqual(["enrich", "extract", "enrich"]);
    expect(ai.calls[2]).toBe("le patron (noun)\nretrouver (verb)\noccupé (adj)");
    expect(await poolSize(me)).toBe(1);
  });

  it("keeps only the ticked words, once", async () => {
    const me = await newLearner(fakeAi({ patron: PATRON, retrouver: RETROUVER, fenêtre: FENETRE, occupé: OCCUPE }, { [TEXT]: FOUND }));
    const dump = await dumpText(me, TEXT);
    const ids = Object.fromEntries(dump.candidates.map((c) => [c.lemma, c.wordId]));

    const kept = await me.call(`/dumps/${dump.id}/commit`, { body: { wordIds: [ids["le patron"], ids["retrouver"]] } });
    expect(kept.status).toBe(200);
    const { dump: after } = await json<{ dump: DumpDetail }>(kept);
    expect(after).toMatchObject({ status: "committed", kept: 2, word: null });
    expect(await poolSize(me)).toBe(2);

    const again = await me.call(`/dumps/${dump.id}/commit`, { body: { wordIds: [ids["occupé"]] } });
    expect(again.status).toBe(409);
    expect(await poolSize(me)).toBe(2);
  });

  it("refuses to keep words the dump didn't offer, or none at all", async () => {
    const me = await newLearner(fakeAi({ patron: PATRON, retrouver: RETROUVER, fenêtre: FENETRE, occupé: OCCUPE }, { [TEXT]: FOUND }));
    const dump = await dumpText(me, TEXT);
    expect((await me.call(`/dumps/${dump.id}/commit`, { body: { wordIds: ["wrd_someone_elses"] } })).status).toBe(400);
    expect((await me.call(`/dumps/${dump.id}/commit`, { body: { wordIds: [] } })).status).toBe(400);
    expect(await poolSize(me)).toBe(0);
  });

  it("puts a sentence with only one word worth learning straight in, keeping the sentence", async () => {
    const text = "Il y a une grève demain.";
    const me = await newLearner(fakeAi({ grève: GREVE }, { [text]: extracted({ form: "grève", lemma: "la grève", pos: "noun" }) }));
    const dump = await dumpText(me, text);
    expect(dump).toMatchObject({ status: "committed", kept: 1, word: { lemma: "la grève" } });
    expect(dump.candidates).toMatchObject([{ lemma: "la grève", sentence: text }]);
    const row = await env.DB.prepare(
      "SELECT c.sentence FROM user_words u JOIN dump_candidates c ON c.dump_id = u.source_dump_id AND c.word_id = u.word_id WHERE u.source_dump_id = ?",
    )
      .bind(dump.id)
      .first();
    expect(row).toEqual({ sentence: text });
  });

  it("leaves out words the lookup dropped, and fails when nothing is worth learning", async () => {
    const vague = "Bon, alors, euh, voilà, tu vois.";
    const me = await newLearner(
      fakeAi(
        { patron: PATRON, retrouver: RETROUVER },
        {
          [TEXT]: extracted(
            { form: "patron", lemma: "le patron", pos: "noun" },
            { form: "retrouvé", lemma: "retrouver", pos: "verb" },
            { form: "machin", lemma: "le machin", pos: "noun" }, // the model returns nothing for it
          ),
          [vague]: extracted(),
        },
      ),
    );
    expect((await dumpText(me, TEXT)).candidates.map((c) => c.lemma)).toEqual(["le patron", "retrouver"]);
    expect(await dumpText(me, vague)).toMatchObject({ status: "failed", error: "Couldn't find any words worth learning in that." });
  });
});

describe("fixing a misread word", () => {
  const MISREAD = extracted(
    { form: "patron", lemma: "le patron", pos: "noun" },
    { form: "occupée", lemma: "occuper", pos: "verb" },
  );

  it("looks the right word up and puts it in the misread one's place", async () => {
    const ai = fakeAi({ patron: PATRON, occuper: OCCUPER, occupé: OCCUPE }, { [TEXT]: MISREAD });
    const me = await newLearner(ai);
    const dump = await dumpText(me, TEXT);
    const wrong = dump.candidates.find((c) => c.lemma === "occuper");
    if (!wrong) throw new Error("expected the misread candidate");

    const res = await me.call(`/dumps/${dump.id}/candidates/${wrong.wordId}`, { method: "PATCH", body: { text: "occupé" } });
    expect(res.status).toBe(200);
    const { dump: fixed, wordId } = await json<{ dump: DumpDetail; wordId: string }>(res);
    expect(fixed.candidates.map((c) => [c.lemma, c.form, c.sentence])).toEqual([
      ["le patron", "patron", TEXT],
      ["occupé", "occupée", TEXT],
    ]);
    expect(wordId).not.toBe(wrong.wordId);
    // The misread word stays in the shared dictionary: words are global.
    expect(await env.DB.prepare("SELECT count(*) AS n FROM words WHERE lemma = 'occuper'").first()).toEqual({ n: 1 });
  });

  it("drops the misread copy when the right word is already offered", async () => {
    const me = await newLearner(fakeAi({ patron: PATRON, occuper: OCCUPER }, { [TEXT]: MISREAD }));
    const dump = await dumpText(me, TEXT);
    const wrong = dump.candidates.find((c) => c.lemma === "occuper");
    const res = await me.call(`/dumps/${dump.id}/candidates/${wrong?.wordId}`, { method: "PATCH", body: { text: "le patron" } });
    expect((await json<{ dump: DumpDetail }>(res)).dump.candidates.map((c) => c.lemma)).toEqual(["le patron"]);
  });

  it("says why a correction isn't a word", async () => {
    const me = await newLearner(fakeAi({ patron: PATRON, occuper: OCCUPER, hello: { kind: "not_french" } }, { [TEXT]: MISREAD }));
    const dump = await dumpText(me, TEXT);
    const wrong = dump.candidates.find((c) => c.lemma === "occuper");
    const res = await me.call(`/dumps/${dump.id}/candidates/${wrong?.wordId}`, { method: "PATCH", body: { text: "hello" } });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "not_a_word", message: "That doesn't look like French.", field: "text" } });
  });
});

describe("discarding", () => {
  it("throws away a dump under review, but not one whose words are in the pool", async () => {
    const me = await newLearner(fakeAi({ patron: PATRON, retrouver: RETROUVER, fenêtre: FENETRE, occupé: OCCUPE, grève: GREVE }, { [TEXT]: FOUND }));
    const dump = await dumpText(me, TEXT);
    expect((await me.call(`/dumps/${dump.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await me.call(`/dumps/${dump.id}`)).status).toBe(404);

    const typed = await dumpText(me, "grève");
    expect((await me.call(`/dumps/${typed.id}`, { method: "DELETE" })).status).toBe(409);
  });

  it("shows a dump whose lookup was cut off as failed, and lets it go", async () => {
    const me = await newLearner(null);
    const { user } = await json<{ user: { id: string } }>(await me.call("/me"));
    await env.DB.prepare("INSERT INTO dumps (id, user_id, kind, raw_text, status, created_at) VALUES (?, ?, 'text', 'perdu', 'extracting', ?)")
      .bind("dmp_stuck", user.id, Date.now() - 60_000)
      .run();
    const { dumps } = await json<{ dumps: DumpView[] }>(await me.call("/dumps"));
    expect(dumps[0]).toMatchObject({ id: "dmp_stuck", status: "failed", error: "The lookup didn't finish. Try again in a moment." });
    expect((await me.call("/dumps/dmp_stuck", { method: "DELETE" })).status).toBe(200);
  });
});
