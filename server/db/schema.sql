CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS partners (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('api', 'mall')),
  stage      TEXT NOT NULL DEFAULT 's0' CHECK (stage IN ('s0', 's1', 's2', 's3', 's4', 's5', 's6', 's6b', 's7', 's8')),
  checks     JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS integration_checklist (
  type       TEXT PRIMARY KEY CHECK (type IN ('api', 'mall')),
  checks     JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO integration_checklist (type, checks) VALUES ('api', '{}'), ('mall', '{}')
ON CONFLICT (type) DO NOTHING;

-- Pre-created here (rather than left to connect-pg-simple's createTableIfMissing)
-- so the app's runtime DB role never needs CREATE privilege — see Task 15.
CREATE TABLE IF NOT EXISTS session (
  sid    VARCHAR NOT NULL,
  sess   JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL,
  CONSTRAINT session_pkey PRIMARY KEY (sid)
);

CREATE INDEX IF NOT EXISTS idx_session_expire ON session (expire);

CREATE TABLE IF NOT EXISTS rate_limits (
  key      TEXT PRIMARY KEY,
  count    INTEGER NOT NULL DEFAULT 0,
  reset_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS feed_analyses (
  id         SERIAL PRIMARY KEY,
  partner_id INTEGER NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  format     TEXT NOT NULL CHECK (format IN ('xml', 'xlsx')),
  metrics    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feed_analyses_partner_created ON feed_analyses (partner_id, created_at DESC);
