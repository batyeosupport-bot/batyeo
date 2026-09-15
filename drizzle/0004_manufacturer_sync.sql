CREATE TABLE `stationProviderLinks` (`id` text PRIMARY KEY NOT NULL,`payload` text NOT NULL,`manufacturer_key` text GENERATED ALWAYS AS (json_extract(payload, '$.manufacturer')) VIRTUAL,`external_key` text GENERATED ALWAYS AS (json_extract(payload, '$.externalId')) VIRTUAL,`station_key` text GENERATED ALWAYS AS (json_extract(payload, '$.stationId')) VIRTUAL,`active_key` integer GENERATED ALWAYS AS (json_extract(payload, '$.active')) VIRTUAL);
CREATE UNIQUE INDEX `provider_external_unique` ON `stationProviderLinks` (`manufacturer_key`,`external_key`);
CREATE UNIQUE INDEX `provider_station_active_unique` ON `stationProviderLinks` (`station_key`,`manufacturer_key`) WHERE `active_key` = 1;
CREATE TABLE `stationProviderSnapshots` (`id` text PRIMARY KEY NOT NULL,`payload` text NOT NULL,`link_key` text GENERATED ALWAYS AS (json_extract(payload, '$.linkId')) VIRTUAL);
CREATE UNIQUE INDEX `provider_snapshot_link_unique` ON `stationProviderSnapshots` (`link_key`);
CREATE TABLE `reconciliationRecords` (`id` text PRIMARY KEY NOT NULL,`payload` text NOT NULL);
CREATE TABLE `manufacturerSyncRuns` (`id` text PRIMARY KEY NOT NULL,`payload` text NOT NULL);
