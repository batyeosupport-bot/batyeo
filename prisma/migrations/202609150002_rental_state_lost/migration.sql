-- New enum values must land in their own migration/transaction: Postgres forbids using a value
-- added by ALTER TYPE ... ADD VALUE inside the same transaction that added it.
ALTER TYPE "RentalState" ADD VALUE 'LOST';
