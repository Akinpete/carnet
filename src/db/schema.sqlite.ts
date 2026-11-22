// The SQLite / D1 target. M0 defines `users` only; the rest of the schema
// (words, user_words, reviews, dumps) arrives in M1. See BACKEND.md.
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { timestampMs } from "./columns.ts";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  timezone: text("timezone").notNull().default("UTC"),
  createdAt: timestampMs("created_at").notNull(),
});
