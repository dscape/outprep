-- Migration 002: Online player profiles, games, and linking
-- Shared schema for items 3 (profile linking) and 5 (persistent storage)

-- ─── Online players ─────────────────────────────────────────────────────────
-- Cached profiles from Lichess / Chess.com

CREATE TABLE IF NOT EXISTS online_players (
  id               SERIAL PRIMARY KEY,
  platform         TEXT NOT NULL,          -- 'lichess' | 'chesscom'
  platform_id      TEXT NOT NULL,          -- immutable ID (lowercase)
  username         TEXT NOT NULL,          -- display name
  slug             TEXT NOT NULL UNIQUE,
  bullet_rating    SMALLINT,
  blitz_rating     SMALLINT,
  rapid_rating     SMALLINT,
  classical_rating SMALLINT,
  title            TEXT,
  profile_data     JSONB NOT NULL DEFAULT '{}',
  last_fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_online_players_platform_id
  ON online_players (platform, platform_id);

-- ─── Online games ───────────────────────────────────────────────────────────
-- Cached games from online platforms

CREATE TABLE IF NOT EXISTS online_games (
  id                SERIAL PRIMARY KEY,
  platform          TEXT NOT NULL,
  platform_game_id  TEXT NOT NULL,
  online_player_id  INTEGER NOT NULL REFERENCES online_players(id) ON DELETE CASCADE,
  player_color      TEXT NOT NULL,         -- 'white' | 'black'
  opponent_name     TEXT,
  opponent_rating   SMALLINT,
  player_rating     SMALLINT,
  speed             TEXT,                  -- 'bullet' | 'blitz' | 'rapid' | 'classical'
  variant           TEXT NOT NULL DEFAULT 'standard',
  rated             BOOLEAN NOT NULL DEFAULT true,
  result            TEXT,                  -- 'win' | 'loss' | 'draw'
  eco               TEXT,
  opening           TEXT,
  played_at         TIMESTAMPTZ,
  moves             TEXT,
  pgn               TEXT,
  evals             JSONB,
  clock_initial     INTEGER,
  clock_increment   INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_online_games_dedup
  ON online_games (platform, platform_game_id, online_player_id);
CREATE INDEX IF NOT EXISTS idx_online_games_player_date
  ON online_games (online_player_id, played_at DESC);

-- ─── Online player links ────────────────────────────────────────────────────
-- Maps online accounts to FIDE players with approval workflow

CREATE TABLE IF NOT EXISTS online_player_links (
  id               SERIAL PRIMARY KEY,
  player_id        INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  online_player_id INTEGER NOT NULL REFERENCES online_players(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | revoked
  suggested_by     TEXT,                             -- IP or user identifier
  suggested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by      TEXT,
  reviewed_at      TIMESTAMPTZ,
  notes            TEXT,
  UNIQUE (player_id, online_player_id)
);

CREATE INDEX IF NOT EXISTS idx_links_approved
  ON online_player_links (player_id) WHERE status = 'approved';
CREATE INDEX IF NOT EXISTS idx_links_pending
  ON online_player_links (status) WHERE status = 'pending';

-- ─── Game dedup links ───────────────────────────────────────────────────────
-- Cross-source deduplication between TWIC games and online games

CREATE TABLE IF NOT EXISTS game_dedup_links (
  id              SERIAL PRIMARY KEY,
  game_id         INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  online_game_id  INTEGER NOT NULL REFERENCES online_games(id) ON DELETE CASCADE,
  match_method    TEXT,  -- 'exact_moves' | 'players_date_result' | 'manual'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (game_id, online_game_id)
);
