-- Initial application schema. Add future changes in new migration files.
CREATE TABLE IF NOT EXISTS app_metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
