-- Outprep database schema
-- Run against Vercel Postgres (Neon) or local PostgreSQL 16+

-- Enable trigram extension for fuzzy name search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── Players ─────────────────────────────────────────────────────────────────
-- Replaces fide/players/{slug}.json (80K files) + fide/index.json (23MB)

CREATE TABLE players (
  id              SERIAL PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  fide_id         TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  title           TEXT,
  federation      TEXT,
  birth_year      SMALLINT,
  fide_rating     SMALLINT NOT NULL,
  standard_rating SMALLINT,
  rapid_rating    SMALLINT,
  blitz_rating    SMALLINT,
  game_count      INTEGER NOT NULL DEFAULT 0,
  win_rate        SMALLINT NOT NULL DEFAULT 0,
  draw_rate       SMALLINT NOT NULL DEFAULT 0,
  loss_rate       SMALLINT NOT NULL DEFAULT 0,
  last_seen       DATE,
  recent_events   JSONB NOT NULL DEFAULT '[]',
  openings        JSONB NOT NULL DEFAULT '{}',
  recent_games    JSONB NOT NULL DEFAULT '[]',
  notable_games   JSONB NOT NULL DEFAULT '[]',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_players_fide_rating ON players (fide_rating DESC);
CREATE INDEX idx_players_fide_id ON players (fide_id);
CREATE INDEX idx_players_name_trgm ON players USING GIN (name gin_trgm_ops);

-- ─── Player aliases ──────────────────────────────────────────────────────────
-- Replaces fide/aliases.json (21MB) — O(1) lookup instead of loading entire map

CREATE TABLE player_aliases (
  alias_slug     TEXT PRIMARY KEY,
  canonical_slug TEXT NOT NULL REFERENCES players(slug) ON DELETE CASCADE
);

CREATE INDEX idx_player_aliases_canonical ON player_aliases (canonical_slug);

-- ─── Games ───────────────────────────────────────────────────────────────────
-- Replaces fide/game-details/{slug}.json (3M files) + fide/game-index.json (1.4GB)
-- PGN text stored directly in this table (TOAST-compressed by Postgres)

CREATE TABLE games (
  id               SERIAL PRIMARY KEY,
  slug             TEXT NOT NULL UNIQUE,
  white_name       TEXT NOT NULL,
  black_name       TEXT NOT NULL,
  white_slug       TEXT,
  black_slug       TEXT,
  white_fide_id    TEXT NOT NULL,
  black_fide_id    TEXT NOT NULL,
  white_elo        SMALLINT NOT NULL,
  black_elo        SMALLINT NOT NULL,
  white_title      TEXT,
  black_title      TEXT,
  white_federation TEXT,
  black_federation TEXT,
  event            TEXT NOT NULL,
  site             TEXT,
  date             DATE NOT NULL,
  round            TEXT,
  eco              TEXT,
  opening          TEXT,
  variation        TEXT,
  result           TEXT NOT NULL,
  pgn              TEXT,
  avg_elo          SMALLINT GENERATED ALWAYS AS ((white_elo + black_elo) / 2) STORED
);

CREATE INDEX idx_games_white_slug ON games (white_slug);
CREATE INDEX idx_games_black_slug ON games (black_slug);
CREATE INDEX idx_games_date ON games (date DESC);
CREATE INDEX idx_games_avg_elo ON games (avg_elo DESC);
CREATE INDEX idx_games_white_fide_id ON games (white_fide_id);
CREATE INDEX idx_games_black_fide_id ON games (black_fide_id);

-- ─── Game aliases ────────────────────────────────────────────────────────────
-- Replaces fide/game-aliases.json (394MB)

CREATE TABLE game_aliases (
  legacy_slug    TEXT PRIMARY KEY,
  canonical_slug TEXT NOT NULL
);

-- ─── Online players ─────────────────────────────────────────────────────────
-- Cached profiles from Lichess / Chess.com

CREATE TABLE online_players (
  id               SERIAL PRIMARY KEY,
  platform         TEXT NOT NULL,
  platform_id      TEXT NOT NULL,
  username         TEXT NOT NULL,
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

CREATE UNIQUE INDEX idx_online_players_platform_id ON online_players (platform, platform_id);

-- ─── Online games ───────────────────────────────────────────────────────────
-- Cached games from online platforms

CREATE TABLE online_games (
  id                SERIAL PRIMARY KEY,
  platform          TEXT NOT NULL,
  platform_game_id  TEXT NOT NULL,
  online_player_id  INTEGER NOT NULL REFERENCES online_players(id) ON DELETE CASCADE,
  player_color      TEXT NOT NULL,
  opponent_name     TEXT,
  opponent_rating   SMALLINT,
  player_rating     SMALLINT,
  speed             TEXT,
  variant           TEXT NOT NULL DEFAULT 'standard',
  rated             BOOLEAN NOT NULL DEFAULT true,
  result            TEXT,
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

CREATE UNIQUE INDEX idx_online_games_dedup ON online_games (platform, platform_game_id, online_player_id);
CREATE INDEX idx_online_games_player_date ON online_games (online_player_id, played_at DESC);

-- ─── Online player links ────────────────────────────────────────────────────
-- Maps online accounts to FIDE players with approval workflow

CREATE TABLE online_player_links (
  id               SERIAL PRIMARY KEY,
  player_id        INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  online_player_id INTEGER NOT NULL REFERENCES online_players(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'pending',
  suggested_by     TEXT,
  suggested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by      TEXT,
  reviewed_at      TIMESTAMPTZ,
  notes            TEXT,
  UNIQUE (player_id, online_player_id)
);

CREATE INDEX idx_links_approved ON online_player_links (player_id) WHERE status = 'approved';
CREATE INDEX idx_links_pending ON online_player_links (status) WHERE status = 'pending';

-- ─── Game dedup links ───────────────────────────────────────────────────────
-- Cross-source deduplication between TWIC games and online games

CREATE TABLE game_dedup_links (
  id              SERIAL PRIMARY KEY,
  game_id         INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  online_game_id  INTEGER NOT NULL REFERENCES online_games(id) ON DELETE CASCADE,
  match_method    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (game_id, online_game_id)
);

-- ─── Pipeline metadata ───────────────────────────────────────────────────────
-- Tracks processed TWIC issues and FIDE rating updates for incremental processing

CREATE TABLE pipeline_runs (
  id            SERIAL PRIMARY KEY,
  run_type      TEXT NOT NULL,          -- 'twic' | 'fide_ratings'
  identifier    TEXT NOT NULL,          -- TWIC issue number or FIDE list date
  status        TEXT NOT NULL DEFAULT 'running',  -- 'running' | 'completed' | 'failed'
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  metadata      JSONB DEFAULT '{}'
);

CREATE UNIQUE INDEX idx_pipeline_runs_unique ON pipeline_runs (run_type, identifier);
