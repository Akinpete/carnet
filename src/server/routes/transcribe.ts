// Spoken answers on iOS (and wherever Web Speech fails): the clip comes in,
// French text goes out, and the clip is gone. It is never stored, logged or
// written to `reviews` (CLAUDE.md, Privacy).
import { Hono } from "hono";
import { z } from "zod";
import { AiError } from "../ai.ts";
import type { AppEnv } from "../env.ts";
import { AppError } from "../errors.ts";
import { requireAuth } from "../middleware/auth.ts";
import { rateLimitByUser } from "../middleware/rateLimit.ts";
import { cleanTranscript } from "../services/extract.ts";
import { validate } from "../validate.ts";

/** A spoken answer is a sentence or two: half a minute is plenty. */
const MAX_BYTES = 4 * 1024 * 1024;

const body = z.object({
  audio: z
    .instanceof(File, { error: "Attach a recording." })
    .refine((f) => f.size > 0, { error: "That recording is empty." })
    .refine((f) => f.size <= MAX_BYTES, { error: "That recording is too long. Say one or two sentences." })
    .refine((f) => /^(audio\/|video\/(mp4|webm))/.test(f.type), { error: "That isn't a recording Carnet can play." }),
});

export const transcribeRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .post("/", rateLimitByUser("transcribe", 400, 24 * 60 * 60), validate("form", body), async (c) => {
    const { ctx } = c.var;
    if (!ctx.ai) throw new AppError(503, "transcription_unavailable", "Speech isn't set up on this server. Type it instead.");
    const file = c.req.valid("form").audio;
    try {
      const heard = await ctx.ai.transcribe({
        route: "transcribe",
        audio: new Uint8Array(await file.arrayBuffer()),
        mediaType: file.type.split(";")[0] ?? file.type,
        language: "fr",
        timeoutMs: 8_000, // per attempt; the client retries a server fault once
      });
      return c.json({ text: cleanTranscript(heard.text) }, 200);
    } catch (err) {
      if (!(err instanceof AiError)) throw err;
      console.error("transcription failed", err.message);
      throw new AppError(503, "transcription_failed", "Couldn't hear that just now. Try again, or type it instead.");
    }
  });
