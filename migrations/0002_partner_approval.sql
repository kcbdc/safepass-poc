-- SafePass independent database only: apply after 0001_init.sql
CREATE TABLE IF NOT EXISTS partners(
 id TEXT PRIMARY KEY, name TEXT NOT NULL, key_hash TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING', created_at TEXT NOT NULL, approved_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_partners_status ON partners(status);
ALTER TABLE disclosure_requests ADD COLUMN reviewed_at TEXT;
