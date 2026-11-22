// Every model call goes through the gateway: an OpenAI-compatible endpoint
// (Cloudflare AI Gateway when hosted, anything compatible when self-hosted).
// Model identity is configuration, never code. Plain fetch, so it's portable.
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
};

export interface Ai {
  /** Returns the model's JSON reply, validated against `schema`. Throws `AiError`. */
  chat<T>(request: ChatRequest<T>): Promise<T>;
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
  return {
    async chat({ route, system, user, schema, cacheTtlSeconds, timeoutMs = 25_000 }) {
      let res: Response;
      try {
        res = await doFetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${config.apiKey}`,
            ...config.headers,
            // Cloudflare AI Gateway headers; other providers ignore them.
            "cf-aig-metadata": JSON.stringify({ route }),
            ...(cacheTtlSeconds ? { "cf-aig-cache-ttl": String(cacheTtlSeconds) } : {}),
          },
          body: JSON.stringify({
            model: config.model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            response_format: { type: "json_object" },
            temperature: 0.2,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        throw new AiError(`The model didn't answer in time (${String(err)}).`, true);
      }
      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).slice(0, 300);
        throw new AiError(`The model gateway returned ${res.status}: ${detail}`, res.status >= 500 || res.status === 429);
      }
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = body.choices?.[0]?.message?.content;
      if (!content) throw new AiError("The model returned an empty reply.", true);
      const parsed = schema.safeParse(parseJson(content));
      if (!parsed.success) throw new AiError(`The model's reply didn't match the expected shape: ${parsed.error.message}`, true);
      return parsed.data;
    },
  };
}
