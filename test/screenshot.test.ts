// M2 part 4: a screenshot is read and extracted in one model call, stored
// privately, and looked up in small parallel batches.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { DumpDetail, DumpView } from "../src/shared/types.ts";
import { extracted, fakeAi, FENETRE, newLearner, OCCUPE, PATRON, RETROUVER, screenshot, type Client } from "./helpers.ts";

const json = async <T>(res: Response) => (await res.json()) as T;

const READ = "Le patron m'a retrouvé une table près de la fenêtre. Elle était occupée.";
const MESSAGE = {
  kind: "items",
  text: READ,
  items: extracted(
    { form: "patron", lemma: "le patron", pos: "noun" },
    { form: "retrouvé", lemma: "retrouver", pos: "verb" },
    { form: "fenêtre", lemma: "la fenêtre", pos: "noun" },
    { form: "occupée", lemma: "occupé", pos: "adj" },
  ).items,
};
const WORDS = { patron: PATRON, retrouver: RETROUVER, fenêtre: FENETRE, occupé: OCCUPE };

async function upload(me: Client, content: string, type?: string) {
  return me.call("/dumps/image", { form: screenshot(content, type) });
}

describe("screenshots", () => {
  it("reads the French and offers its words, with one call to read and parallel calls to look up", async () => {
    const ai = fakeAi(WORDS, { "image:message de julie": MESSAGE });
    const me = await newLearner(ai);

    const res = await upload(me, "message de julie");
    expect(res.status).toBe(202);
    const { dump: created } = await json<{ dump: DumpView }>(res);
    expect(created).toMatchObject({ kind: "image", status: "extracting" });

    const { dump } = await json<{ dump: DumpDetail }>(await me.call(`/dumps/${created.id}`));
    expect(dump).toMatchObject({ status: "awaiting_review", text: READ, found: { total: 4, fresh: 4 } });
    expect(dump.candidates.map((c) => [c.lemma, c.sentence])).toEqual([
      ["le patron", "Le patron m'a retrouvé une table près de la fenêtre."],
      ["retrouver", "Le patron m'a retrouvé une table près de la fenêtre."],
      ["la fenêtre", "Le patron m'a retrouvé une table près de la fenêtre."],
      ["occupé", "Elle était occupée."],
    ]);
    // One call reads and extracts; four new words go out as two batches at once.
    expect(ai.routes).toEqual(["extract", "enrich", "enrich"]);
    expect(ai.calls.slice(1).sort()).toEqual(["le patron (noun)\nretrouver (verb)\nla fenêtre (noun)", "occupé (adj)"]);
  });

  it("keeps the screenshot private: its owner can see it, nobody else", async () => {
    const me = await newLearner(fakeAi(WORDS, { "image:mon écran": MESSAGE }));
    const { dump } = await json<{ dump: DumpView }>(await upload(me, "mon écran"));

    const mine = await me.call(`/dumps/${dump.id}/image`);
    expect(mine.status).toBe(200);
    expect(mine.headers.get("content-type")).toBe("image/png");
    expect(mine.headers.get("cache-control")).toContain("private");
    expect(await mine.text()).toBe("mon écran");

    const stranger = await newLearner(null);
    expect((await stranger.call(`/dumps/${dump.id}/image`)).status).toBe(404);
  });

  it("says when there's no French to read", async () => {
    const me = await newLearner(fakeAi({}, { "image:a cat": { kind: "not_french", text: null, items: [] } }));
    const { dump } = await json<{ dump: DumpView }>(await upload(me, "a cat"));
    const { dump: done } = await json<{ dump: DumpView }>(await me.call(`/dumps/${dump.id}`));
    expect(done).toMatchObject({ status: "failed", error: "Couldn't read any French in that image." });
  });

  it("refuses files that aren't images", async () => {
    const me = await newLearner(null);
    const res = await upload(me, "not an image", "text/plain");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_input", field: "image" } });
  });

  it("removes the stored screenshot when the dump is discarded", async () => {
    const me = await newLearner(fakeAi(WORDS, { "image:à jeter": MESSAGE }));
    const { dump } = await json<{ dump: DumpView }>(await upload(me, "à jeter"));
    const { user } = await json<{ user: { id: string } }>(await me.call("/me"));
    const key = `uploads/${user.id}/${dump.id}`;
    expect(await env.UPLOADS.get(key)).not.toBeNull();

    expect((await me.call(`/dumps/${dump.id}`, { method: "DELETE" })).status).toBe(200);
    expect(await env.UPLOADS.get(key)).toBeNull();
  });
});
