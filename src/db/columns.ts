// The dialect-divergent column types live here, so table definitions stay
// identical across targets. SQLite (D1) only until the Postgres target lands
// in M6; `schema.pg.ts` will define the same helpers with pg-core types
// (`timestamp`, `boolean`, `jsonb`).
import { integer, text } from "drizzle-orm/sqlite-core";

/** Epoch milliseconds. Becomes `timestamp` on Postgres. */
export const timestampMs = (name: string) => integer(name);

/** Becomes `boolean` on Postgres. */
export const bool = (name: string) => integer(name, { mode: "boolean" });

/** JSON stored as text. Becomes `jsonb` on Postgres. */
export const json = <T>(name: string) => text(name, { mode: "json" }).$type<T>();
