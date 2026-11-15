CREATE TABLE IF NOT EXISTS accounts (sub TEXT PRIMARY KEY, email TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','organizer')), status TEXT NOT NULL CHECK(status IN ('pending','approved','suspended')), created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, sub TEXT NOT NULL REFERENCES accounts(sub), expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
CREATE TABLE IF NOT EXISTS snapshots (sub TEXT PRIMARY KEY REFERENCES accounts(sub), revision TEXT NOT NULL, data TEXT NOT NULL);
