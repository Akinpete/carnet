CREATE TABLE `dumps` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`source_ref` text,
	`raw_text` text,
	`status` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `dumps_user_status` ON `dumps` (`user_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`word_id` text NOT NULL,
	`session_id` text,
	`rung` integer NOT NULL,
	`grade` integer NOT NULL,
	`error_kind` text,
	`answer_text` text,
	`contested` integer DEFAULT false NOT NULL,
	`edited` integer DEFAULT false NOT NULL,
	`latency_ms` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reviews_user_word` ON `reviews` (`user_id`,`word_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_session_word` ON `reviews` (`session_id`,`word_id`);--> statement-breakpoint
CREATE TABLE `sessions_generated` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`slot` text NOT NULL,
	`for_date` text NOT NULL,
	`cards` text NOT NULL,
	`started_at` integer,
	`completed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sess_slot` ON `sessions_generated` (`user_id`,`for_date`,`slot`);--> statement-breakpoint
CREATE TABLE `user_words` (
	`user_id` text NOT NULL,
	`word_id` text NOT NULL,
	`rung` integer DEFAULT 1 NOT NULL,
	`ease` real DEFAULT 2.5 NOT NULL,
	`interval_days` integer DEFAULT 0 NOT NULL,
	`due_on` text NOT NULL,
	`reps` integer DEFAULT 0 NOT NULL,
	`lapses` integer DEFAULT 0 NOT NULL,
	`is_leech` integer DEFAULT false NOT NULL,
	`origin` text NOT NULL,
	`source_dump_id` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `word_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`word_id`) REFERENCES `words`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_dump_id`) REFERENCES `dumps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `uw_due` ON `user_words` (`user_id`,`due_on`,`is_leech`);--> statement-breakpoint
CREATE TABLE `words` (
	`id` text PRIMARY KEY NOT NULL,
	`lemma` text NOT NULL,
	`pos` text NOT NULL,
	`gender` text,
	`translation` text NOT NULL,
	`gloss` text,
	`usage_note` text,
	`distractors` text,
	`audio_key` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `words_lemma_pos` ON `words` (`lemma`,`pos`);