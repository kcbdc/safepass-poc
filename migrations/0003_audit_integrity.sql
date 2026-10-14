-- v1.3 additive migration: do NOT rerun 0001_init.sql against existing D1.
CREATE TABLE IF NOT EXISTS audit_integrity(
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 event_id TEXT NOT NULL UNIQUE,
 event_type TEXT NOT NULL,
 rental_id TEXT,
 at TEXT NOT NULL,
 detail TEXT NOT NULL DEFAULT '',
 previous_hash TEXT NOT NULL,
 entry_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_audit_integrity_event ON audit_integrity(event_id);
