// Every model call goes through the gateway: an OpenAI-compatible endpoint
// (Cloudflare AI Gateway when hosted, anything compatible when self-hosted).
// Model identity is configuration, never code. Plain fetch, so it's portable.
import { Buffer } from "node:buffer";
import type { ZodType } from "zod";

/** Named routes: the gateway keys caching, limits and cost attribution off them. */
export type AiRoute = "extract" | "enrich" | "generate" | "grade" | "diagnose" | "speak" | "transcribe";

export type ChatRequest<T> = {
  route: AiRoute;
  system: string;
  user: string;
  schema: ZodType<T>;
  /** Ask the gateway to cache identical requests (enrichment is deterministic per word). */
  cacheTtlSeconds?: number;
  timeoutMs?: number;
  /** An image sent with the user text (screenshots). Base64, without the data: prefix. */
  image?: { mediaType: string; base64: string };
  /** Cap on the reply's length. Set it: Workers AI otherwise stops at 256 tokens. */
  maxTokens?: number;
};

export type TranscribeRequest = {
  route: "transcribe";
  audio: Uint8Array;
  mediaType: string;
  /** Expected language. Forcing French helps with a learner's accent. */
  language?: string;
  timeoutMs?: number;
};

export interface Ai {
  /** Returns the model's JSON reply, validated against `schema`. Throws `AiError`. */
  chat<T>(request: ChatRequest<T>): Promise<T>;
  /** Speech to text. Throws `AiError`; `null` from the factory when no model is set. */
  transcribe(request: TranscribeRequest): Promise<{ text: string }>;
}

export class AiError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
  }
}

export type GatewayConfig = {
  /** Base URL of an OpenAI-compatible API, without `/chat/completions`. */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Extra headers on every call, e.g. `cf-aig-gateway-id` for Cloudflare's AI Gateway. */
  headers?: Record<string, string>;
  /**
   * Speech to text. Workers AI's own shape (POST JSON with base64 audio to
   * `url`, the model is in the path) or OpenAI's (`/audio/transcriptions`,
   * multipart), for self-hosting.
   */
  transcribe?: { style: "workers-ai"; url: string } | { style: "openai"; model: string };
  fetch?: typeof fetch;
};

/** Pulls the first JSON object out of a reply, tolerating ```json fences. */
function parseJson(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const text = (fenced?.[1] ?? content).trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end < start) throw new AiError("The model didn't return JSON.", true);
  return JSON.parse(text.slice(start, end + 1));
}

export function createGatewayAi(config: GatewayConfig): Ai {
  const doFetch = config.fetch ?? fetch;
  const base = config.baseUrl.replace(/\/$/, "");
  const auth = { authorization: `Bearer ${config.apiKey}`, ...config.headers };

  async function send(url: string, init: RequestInit, route: AiRoute, timeoutMs: number): Promise<Response> {
    let res: Response;
    try {
      res = await doFetch(url, {
        ...init,
        headers: { ...auth, "cf-aig-metadata": JSON.stringify({ route }), ...(init.headers as Record<string, string>) },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new AiError(`The model didn't answer in time (${String(err)}).`, true);
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      throw new AiError(`The model gateway returned ${res.status}: ${detail}`, res.status >= 500 || res.status === 429);
    }
    return res;
  }

  async function transcribeOnce({ route, audio, mediaType, language, timeoutMs = 15_000 }: TranscribeRequest): Promise<{ text: string }> {
    const t = config.transcribe;
    if (!t) throw new AiError("No transcription model is configured.", false);
    let text: string | undefined;
    if (t.style === "workers-ai") {
      const body = JSON.stringify({ audio: Buffer.from(audio).toString("base64"), ...(language ? { language } : {}) });
      const res = await send(t.url, { method: "POST", headers: { "content-type": "application/json" }, body }, route, timeoutMs);
      text = ((await res.json()) as { result?: { text?: string } }).result?.text;
    } else {
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(audio)], { type: mediaType }), "clip");
      form.append("model", t.model);
      if (language) form.append("language", language);
      const res = await send(`${base}/audio/transcriptions`, { method: "POST", body: form }, route, timeoutMs);
      text = ((await res.json()) as { text?: string }).text;
    }
    if (typeof text !== "string") throw new AiError("The transcription came back empty.", true);
    return { text };
  }

  return {
    async transcribe(request) {
      // One retry on a server fault: Workers AI's speech machines fail now and then
      // (seen 2026-11-25: "libcublas.so.12 is not found"), and the next is usually fine.
      try {
        return await transcribeOnce(request);
      } catch (err) {
        if (err instanceof AiError && err.retryable) return transcribeOnce(request);
        throw err;
      }
    },


    async chat({ route, system, user, image, schema, cacheTtlSeconds, timeoutMs = 25_000, maxTokens = 1024 }) {
      const body = JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: image
              ? [
                  { type: "text", text: user },
                  { type: "image_url", image_url: { url: `data:${image.mediaType};base64,${image.base64}` } },
                ]
              : user,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: maxTokens,
      });
      const headers: Record<string, string> = {
        "content-type": "application/json",
        // Cloudflare AI Gateway caching; other providers ignore it.
        ...(cacheTtlSeconds ? { "cf-aig-cache-ttl": String(cacheTtlSeconds) } : {}),
      };
      const res = await send(`${base}/chat/completions`, { method: "POST", headers, body }, route, timeoutMs);
      const reply = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = reply.choices?.[0]?.message?.content;
      if (!content) throw new AiError("The model returned an empty reply.", true);
      const parsed = schema.safeParse(parseJson(content));
      if (!parsed.success) throw new AiError(`The model's reply didn't match the expected shape: ${parsed.error.message}`, true);
      return parsed.data;
    },
  };
}
