CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL, password_hash TEXT, salt TEXT, program TEXT NOT NULL, semester TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('student','teacher','organizer')), scope TEXT NOT NULL, demo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(email, scope));
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE TABLE events (id TEXT PRIMARY KEY, scope TEXT NOT NULL, owner_id TEXT NOT NULL, title TEXT NOT NULL, category TEXT NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL, end_time TEXT NOT NULL, location TEXT NOT NULL, organizer TEXT NOT NULL, capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 10000), program TEXT NOT NULL, image TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','cancelled')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE registrations (event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(event_id,user_id));
CREATE TABLE auth_attempts (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0, window_start INTEGER NOT NULL);
CREATE INDEX events_scope_date ON events(scope,date);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE INDEX registrations_user ON registrations(user_id);
