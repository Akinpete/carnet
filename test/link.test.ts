// M2 part 5: a pasted link is fetched, cut to its article, and extracted like text.
import { describe, expect, it } from "vitest";
import type { DumpDetail, DumpView } from "../src/shared/types.ts";
import { extracted, fakeAi, fakeWeb, GREVE, newLearner, RETROUVER } from "./helpers.ts";

const json = async <T>(res: Response) => (await res.json()) as T;

const URL_ = "https://journal.example/trains-de-nuit";
const TEXT = "Pourquoi les trains de nuit reviennent.\nLes voyageurs retrouvent le train malgré la grève.";
const WEB = fakeWeb({ [URL_]: { ok: true, article: { title: "Pourquoi les trains de nuit reviennent", text: TEXT } } });
const AI = fakeAi(
  { retrouver: RETROUVER, grève: GREVE },
  { [TEXT]: extracted({ form: "retrouvent", lemma: "retrouver", pos: "verb" }, { form: "grève", lemma: "la grève", pos: "noun" }) },
);

describe("links", () => {
  it("reads the article and offers its words, with the page as the source", async () => {
    const me = await newLearner(AI, "UTC", WEB);
    const res = await me.call("/dumps", { body: { text: `  ${URL_} ` } });
    expect(res.status).toBe(202);
    const { dump: created } = await json<{ dump: DumpView }>(res);
    expect(created).toMatchObject({ kind: "url", source: URL_, text: "" });

    const { dump } = await json<{ dump: DumpDetail }>(await me.call(`/dumps/${created.id}`));
    expect(dump).toMatchObject({ status: "awaiting_review", source: URL_, text: TEXT });
    expect(dump.candidates.map((c) => [c.lemma, c.sentence])).toEqual([
      ["retrouver", "Les voyageurs retrouvent le train malgré la grève."],
      ["la grève", "Les voyageurs retrouvent le train malgré la grève."],
    ]);
    expect(WEB.reads).toContain(URL_);
  });

  it("says why a page couldn't be read", async () => {
    const me = await newLearner(AI, "UTC", WEB);
    const { dump } = await json<{ dump: DumpView }>(await me.call("/dumps", { body: { text: "https://journal.example/gone" } }));
    const { dump: done } = await json<{ dump: DumpView }>(await me.call(`/dumps/${dump.id}`));
    expect(done).toMatchObject({ status: "failed", error: "That page doesn't exist any more." });
  });

  it("treats a link inside a sentence as text, not as a link", async () => {
    const me = await newLearner(fakeAi({}), "UTC", WEB);
    const { dump } = await json<{ dump: DumpView }>(
      await me.call("/dumps", { body: { text: `Lisez ${URL_} ce matin, c'est passionnant.` } }),
    );
    expect(dump.kind).toBe("text");
  });
});
