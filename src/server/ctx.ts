// The portability seam. Business logic sees only these interfaces; which
// implementation is behind them is decided once, in the platform entry
// (src/worker/index.ts now, src/node/index.ts in M6). Nothing here may
// import a Cloudflare API.
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type * as schema from "../db/schema.sqlite.ts";

/**
 * Database handle. SQLite (D1) only until the Postgres target lands in M6.
 * The result type is `any` because it differs per driver.
 */
export type Db = BaseSQLiteDatabase<"async", any, typeof schema>;

/** Ephemeral key-value store: sessions and rate-limit counters. */
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
  kv: Kv;
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
