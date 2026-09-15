CREATE TABLE `runtimeCredentials` (`id` text PRIMARY KEY NOT NULL,`payload` text NOT NULL);
CREATE TABLE `runtimeEnrollmentTokens` (`id` text PRIMARY KEY NOT NULL,`payload` text NOT NULL);
CREATE TABLE `hardwareDiscoveryReports` (`id` text PRIMARY KEY NOT NULL,`payload` text NOT NULL);
CREATE TABLE `stationCapabilities` (`id` text PRIMARY KEY NOT NULL,`payload` text NOT NULL,`station_key` text GENERATED ALWAYS AS (json_extract(payload, '$.stationId')) VIRTUAL,`capability_key` text GENERATED ALWAYS AS (json_extract(payload, '$.capability')) VIRTUAL);
CREATE UNIQUE INDEX `station_capability_unique` ON `stationCapabilities` (`station_key`,`capability_key`);
