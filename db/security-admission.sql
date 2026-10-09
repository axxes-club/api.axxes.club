-- Apply before traffic promotion. Product-owned table only; no shared schema changes.
CREATE TABLE IF NOT EXISTS api_security_rate_limits (key text PRIMARY KEY, hits integer NOT NULL CHECK(hits>0), expires_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS api_security_rate_limits_expiry ON api_security_rate_limits(expires_at);
-- Maintenance: DELETE FROM api_security_rate_limits WHERE expires_at < now();
