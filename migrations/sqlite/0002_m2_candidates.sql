CREATE TABLE `dump_candidates` (
	`dump_id` text NOT NULL,
	`word_id` text NOT NULL,
	`form` text,
	`sentence` text,
	`position` integer NOT NULL,
	PRIMARY KEY(`dump_id`, `word_id`),
	FOREIGN KEY (`dump_id`) REFERENCES `dumps`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`word_id`) REFERENCES `words`(`id`) ON UPDATE no action ON DELETE no action
);
