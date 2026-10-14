-- SafePass incremental migration; run ONCE after 0001 and prior project migrations.
ALTER TABLE rental_requests ADD COLUMN demo_holder TEXT DEFAULT '';
CREATE TABLE IF NOT EXISTS request_limits(id TEXT PRIMARY KEY,bucket_key TEXT NOT NULL,at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_limits_bucket ON request_limits(bucket_key,at);
CREATE TABLE IF NOT EXISTS demo_consents(id TEXT PRIMARY KEY,rental_id TEXT NOT NULL,holder_hash TEXT NOT NULL,version TEXT NOT NULL,agreed_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_consents_rental ON demo_consents(rental_id);
CREATE TABLE IF NOT EXISTS demo_notices(id TEXT PRIMARY KEY,rental_id TEXT NOT NULL,message TEXT NOT NULL,at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_notices_rental ON demo_notices(rental_id,at);
