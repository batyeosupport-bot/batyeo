CREATE TABLE `displayConfigs` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stationHeartbeats` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL
);
