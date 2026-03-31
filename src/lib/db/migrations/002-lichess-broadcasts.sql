-- Migration 002: Lichess broadcast ingestion support
-- Idempotent: safe to run multiple times

-- ─── New columns on games ───────────────────────────────────────────────────
-- Support Lichess broadcast metadata and multi-source deduplication

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'games' AND column_name = 'source_key'
  ) THEN
    ALTER TABLE games ADD COLUMN source_key TEXT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'games' AND column_name = 'content_fingerprint'
  ) THEN
    ALTER TABLE games ADD COLUMN content_fingerprint TEXT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'games' AND column_name = 'source'
  ) THEN
    ALTER TABLE games ADD COLUMN source TEXT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'games' AND column_name = 'broadcast_id'
  ) THEN
    ALTER TABLE games ADD COLUMN broadcast_id TEXT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'games' AND column_name = 'round_id'
  ) THEN
    ALTER TABLE games ADD COLUMN round_id TEXT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'games' AND column_name = 'time_control'
  ) THEN
    ALTER TABLE games ADD COLUMN time_control TEXT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'games' AND column_name = 'board'
  ) THEN
    ALTER TABLE games ADD COLUMN board TEXT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'games' AND column_name = 'utc_time'
  ) THEN
    ALTER TABLE games ADD COLUMN utc_time TEXT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'games' AND column_name = 'game_url'
  ) THEN
    ALTER TABLE games ADD COLUMN game_url TEXT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'games' AND column_name = 'move_count'
  ) THEN
    ALTER TABLE games ADD COLUMN move_count SMALLINT;
  END IF;
END $$;

-- Partial unique index on source_key (only for non-null values)
CREATE UNIQUE INDEX IF NOT EXISTS idx_games_source_key
  ON games (source_key) WHERE source_key IS NOT NULL;

-- Index on content_fingerprint for cross-source dedup lookups
CREATE INDEX IF NOT EXISTS idx_games_content_fingerprint
  ON games (content_fingerprint) WHERE content_fingerprint IS NOT NULL;

-- Index on source for filtering
CREATE INDEX IF NOT EXISTS idx_games_source
  ON games (source) WHERE source IS NOT NULL;

-- ─── Lichess broadcasts ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lichess_broadcasts (
  id              SERIAL PRIMARY KEY,
  broadcast_id    TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  discovered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status          TEXT NOT NULL DEFAULT 'tracking',  -- 'tracking' | 'complete'
  last_polled_at  TIMESTAMPTZ,
  metadata        JSONB DEFAULT '{}'
);

-- ─── Lichess broadcast rounds ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lichess_broadcast_rounds (
  id              SERIAL PRIMARY KEY,
  round_id        TEXT NOT NULL UNIQUE,
  broadcast_id    TEXT NOT NULL REFERENCES lichess_broadcasts(broadcast_id),
  name            TEXT,
  status          TEXT NOT NULL DEFAULT 'new',  -- 'new' | 'started' | 'finished'
  last_fetched_at TIMESTAMPTZ,
  pgn_hash        TEXT
);

CREATE INDEX IF NOT EXISTS idx_broadcast_rounds_status
  ON lichess_broadcast_rounds (broadcast_id, status);
