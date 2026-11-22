// Typed client inferred from the server's routes. No codegen: a server
// change that breaks the client fails at build time.
import { hc } from "hono/client";
import type { Api } from "../../server/app.ts";
import type { ErrorBody } from "../../shared/types.ts";

export const api = hc<Api>("/api");

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly field: string | undefined;

  constructor(status: number, code: string, message: string, field?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

/** Resolves to the success body, or throws an `ApiError` from the error envelope. */
export async function unwrap<T>(request: Promise<{ ok: boolean; status: number; json(): Promise<T> }>): Promise<T> {
  let res: Awaited<typeof request>;
  try {
    res = await request;
  } catch {
    throw new ApiError(0, "offline", "Couldn't reach Carnet. Check your connection and try again.");
  }
  if (res.ok) return res.json();
  const body = (await res.json().catch(() => null)) as ErrorBody | null;
  const err = body?.error;
  throw new ApiError(res.status, err?.code ?? "internal", err?.message ?? "Something went wrong.", err?.field);
}
