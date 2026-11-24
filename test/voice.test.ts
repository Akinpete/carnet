// M2 part 7: a voice note is transcribed, forgotten, and its text extracted.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { DumpDetail, DumpView } from "../src/shared/types.ts";
import { extracted, fakeAi, GREVE, newLearner, RETROUVER, voiceNote, type Client } from "./helpers.ts";

const json = async <T>(res: Response) => (await res.json()) as T;

const HEARD = "On a retrouvé le chat pendant la grève.";

async function record(me: Client, content: string, type?: string): Promise<DumpDetail> {
  const res = await me.call("/dumps/audio", { form: voiceNote(content, type) });
  if (res.status !== 202) throw new Error(`upload failed: ${res.status} ${await res.text()}`);
  const { dump } = await json<{ dump: DumpView }>(res);
  return (await json<{ dump: DumpDetail }>(await me.call(`/dumps/${dump.id}`))).dump;
}

describe("voice notes", () => {
  it("transcribes in French and offers the words, keeping the text but not the recording", async () => {
    const ai = fakeAi(
      { retrouver: RETROUVER, grève: GREVE },
      { [HEARD]: extracted({ form: "retrouvé", lemma: "retrouver", pos: "verb" }, { form: "grève", lemma: "la grève", pos: "noun" }) },
      { "clip-1": HEARD },
    );
    const me = await newLearner(ai);
    const dump = await record(me, "clip-1");
    expect(dump).toMatchObject({ kind: "audio", status: "awaiting_review", text: HEARD });
    expect(dump.candidates.map((c) => [c.lemma, c.sentence])).toEqual([
      ["retrouver", HEARD],
      ["la grève", HEARD],
    ]);
    expect(ai.routes[0]).toBe("transcribe");
    const stored = await env.UPLOADS.list();
    expect(stored.objects.filter((o) => o.key.includes(dump.id))).toEqual([]);
  });

  it("puts a single spoken word straight in, like a typed one", async () => {
    const me = await newLearner(fakeAi({ Grève: GREVE }, {}, { "clip-2": "Grève." }));
    expect(await record(me, "clip-2")).toMatchObject({ status: "committed", word: { lemma: "la grève" } });
  });

  it("says so when there was nothing to hear, including Whisper's stock subtitles", async () => {
    const me = await newLearner(fakeAi({}, {}, { "clip-3": "", "clip-4": "Sous-titres réalisés par la communauté d'Amara.org" }));
    const silent = "Couldn't hear any French in that recording. Try again a little closer.";
    expect(await record(me, "clip-3")).toMatchObject({ status: "failed", error: silent });
    expect(await record(me, "clip-4")).toMatchObject({ status: "failed", error: silent });
  });

  it("takes the formats phones record (MP4 on iPhone, WebM elsewhere) and refuses the rest", async () => {
    const me = await newLearner(fakeAi({ grève: GREVE }, {}, { "clip-5": "grève" }));
    expect((await record(me, "clip-5", "audio/webm;codecs=opus")).status).toBe("committed");
    const res = await me.call("/dumps/audio", { form: voiceNote("clip-6", "image/png") });
    expect(res.status).toBe(400);
  });
});
