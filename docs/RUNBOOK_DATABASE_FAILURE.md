# Database failure

Stop scheduler and mutations. Check connectivity and migration status without reset, preserve provider observations, restore PostgreSQL, then run integrity/reconciliation checks before resuming.
