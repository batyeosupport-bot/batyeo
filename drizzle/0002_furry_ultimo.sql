ALTER TABLE `partnerUsers` ADD `user_key` text GENERATED ALWAYS AS (json_extract(payload, '$.userId')) VIRTUAL;--> statement-breakpoint
ALTER TABLE `partnerUsers` ADD `partner_key` text GENERATED ALWAYS AS (json_extract(payload, '$.partnerId')) VIRTUAL;--> statement-breakpoint
CREATE UNIQUE INDEX `membership_unique` ON `partnerUsers` (`user_key`,`partner_key`);--> statement-breakpoint
ALTER TABLE `payments` ADD `rental_key` text GENERATED ALWAYS AS (json_extract(payload, '$.rentalId')) VIRTUAL;--> statement-breakpoint
CREATE UNIQUE INDEX `payments_rental_unique` ON `payments` (`rental_key`);--> statement-breakpoint
ALTER TABLE `rentals` ADD `customer_key` text GENERATED ALWAYS AS (json_extract(payload, '$.customerId')) VIRTUAL;--> statement-breakpoint
ALTER TABLE `rentals` ADD `battery_key` text GENERATED ALWAYS AS (json_extract(payload, '$.batteryId')) VIRTUAL;--> statement-breakpoint
ALTER TABLE `rentals` ADD `idempotency_key` text GENERATED ALWAYS AS (json_extract(payload, '$.idempotencyKey')) VIRTUAL;--> statement-breakpoint
ALTER TABLE `rentals` ADD `partner_key` text GENERATED ALWAYS AS (json_extract(payload, '$.partnerId')) VIRTUAL;--> statement-breakpoint
ALTER TABLE `rentals` ADD `created_time` integer GENERATED ALWAYS AS (json_extract(payload, '$.createdAt')) VIRTUAL;--> statement-breakpoint
ALTER TABLE `rentals` ADD `rental_state` text GENERATED ALWAYS AS (json_extract(payload, '$.state')) VIRTUAL;--> statement-breakpoint
CREATE UNIQUE INDEX `rentals_idempotency_unique` ON `rentals` (`customer_key`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `rentals_open_customer_unique` ON `rentals` (`customer_key`) WHERE "rentals"."rental_state" IN ('CREATED','PAYMENT_AUTH','EJECTING','ACTIVE','RETURN_PENDING','RETURNED','OVERDUE','ERROR');--> statement-breakpoint
CREATE UNIQUE INDEX `rentals_open_battery_unique` ON `rentals` (`battery_key`) WHERE "rentals"."rental_state" IN ('CREATED','PAYMENT_AUTH','EJECTING','ACTIVE','RETURN_PENDING','RETURNED','OVERDUE','ERROR');--> statement-breakpoint
CREATE INDEX `rentals_tenant_created` ON `rentals` (`partner_key`,`created_time`);--> statement-breakpoint
ALTER TABLE `slots` ADD `battery_key` text GENERATED ALWAYS AS (json_extract(payload, '$.batteryId')) VIRTUAL;--> statement-breakpoint
ALTER TABLE `slots` ADD `station_key` text GENERATED ALWAYS AS (json_extract(payload, '$.stationId')) VIRTUAL;--> statement-breakpoint
ALTER TABLE `slots` ADD `slot_position` integer GENERATED ALWAYS AS (json_extract(payload, '$.position')) VIRTUAL;--> statement-breakpoint
CREATE UNIQUE INDEX `slots_battery_unique` ON `slots` (`battery_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `slots_position_unique` ON `slots` (`station_key`,`slot_position`);--> statement-breakpoint
ALTER TABLE `terms` ADD `rental_key` text GENERATED ALWAYS AS (json_extract(payload, '$.rentalId')) VIRTUAL;--> statement-breakpoint
CREATE UNIQUE INDEX `terms_rental_unique` ON `terms` (`rental_key`);