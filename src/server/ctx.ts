// The portability seam. Business logic sees only these interfaces; which
// implementation is behind them is decided once, in the platform entry
// (src/worker/index.ts now, src/node/index.ts in M6). Nothing here may
// import a Cloudflare API.
import type { BatchItem } from "drizzle-orm/batch";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type * as schema from "../db/schema.sqlite.ts";
import type { Ai } from "./ai.ts";

/**
 * Database handle. SQLite (D1) only until the Postgres target lands in M6.
 * The result type is `any` because it differs per driver.
 */
export type Db = BaseSQLiteDatabase<"async", any, typeof schema>;

/**
 * Runs several writes all-or-nothing. Pass unexecuted Drizzle queries; the
 * results come back in the same order. D1 has no interactive transactions,
 * so this is `db.batch()` there and a real transaction on Postgres. Never
 * call `db.batch()` directly (BACKEND.md, rule 7).
 */
export type Tx = <T extends readonly [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]>(
  queries: T,
) => Promise<{ [K in keyof T]: Awaited<T[K]> }>;

/** Ephemeral key-value store: sessions, rate limits, idempotency keys. */
export interface Kv {
  get(key: string): Promise<string | null>;
  /** `ttlSeconds` must be at least 60 (the Workers KV minimum). */
  put(key: string, value: string, options?: { ttlSeconds?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Runs work after the response has been sent. */
export type Defer = (task: () => Promise<unknown>) => void;

export type Ctx = {
  db: Db;
  tx: Tx;
  kv: Kv;
  /** `null` when no model is configured: features that need one degrade, never crash. */
  ai: Ai | null;
  defer: Defer;
  /** The caller's IP as the platform reports it, for per-IP rate limits. */
  clientIp: (req: Request) => string | null;
  config: Config;
};

/** Deployment settings, read once by the platform entry. */
export type Config = {
  /** scrypt N. Lower on the Workers free plan (10 ms CPU limit); see BACKEND.md, Auth. */
  passwordCost: number;
};
