-- Migration 001: Events table and event_slug on games
-- Idempotent: safe to run multiple times

-- ─── Events table ───────────────────────────────────────────────────────────
-- Aggregated from games.event — one row per unique event name

CREATE TABLE IF NOT EXISTS events (
  id         SERIAL PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  site       TEXT,
  date_start DATE,
  date_end   DATE,
  game_count INTEGER NOT NULL DEFAULT 0,
  avg_elo    SMALLINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_date ON events (date_end DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_events_name_trgm ON events USING GIN (name gin_trgm_ops);

-- ─── Link games to events ───────────────────────────────────────────────────
-- Add event_slug column to games for fast event page queries

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'games' AND column_name = 'event_slug'
  ) THEN
    ALTER TABLE games ADD COLUMN event_slug TEXT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_games_event_slug ON games (event_slug);
