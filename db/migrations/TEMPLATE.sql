-- TEMPLATE.sql
-- Zero-downtime friendly migration scaffold (Expand → Migrate/Backfill → Contract)

/* 1) EXPAND */ 
-- ALTER TABLE ... ADD COLUMN ...;

/* 2) MIGRATE/BACKFILL (outside long TX) */
/* jobs/batches */

/* 3) CONTRACT */
/* DROP old column */

/* 4) ROLLBACK */
/* revert steps */
