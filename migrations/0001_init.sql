CREATE TABLE IF NOT EXISTS rental_requests(id TEXT PRIMARY KEY,partner_id TEXT NOT NULL,item TEXT NOT NULL,hours INTEGER NOT NULL,request_code_hash TEXT NOT NULL UNIQUE,status TEXT NOT NULL DEFAULT 'REQUESTED',created_at TEXT NOT NULL,expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS guarantee_tokens(id TEXT PRIMARY KEY,rental_id TEXT NOT NULL UNIQUE,holder_pseudonym TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,status TEXT NOT NULL DEFAULT 'ACTIVE',issued_at TEXT NOT NULL,expires_at TEXT NOT NULL,revoked_at TEXT,FOREIGN KEY(rental_id) REFERENCES rental_requests(id));
CREATE TABLE IF NOT EXISTS disclosure_requests(id TEXT PRIMARY KEY,rental_id TEXT NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',created_at TEXT NOT NULL,reviewed_at TEXT);
CREATE TABLE IF NOT EXISTS audit_events(id TEXT PRIMARY KEY,event_type TEXT NOT NULL,rental_id TEXT,at TEXT NOT NULL,detail TEXT);
CREATE INDEX IF NOT EXISTS ix_audit_recent ON audit_events(at DESC);

-- For fresh installations; existing deployments already have this table and columns.
CREATE TABLE IF NOT EXISTS partners(id TEXT PRIMARY KEY,name TEXT NOT NULL,key_hash TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING',created_at TEXT NOT NULL,approved_at TEXT);
