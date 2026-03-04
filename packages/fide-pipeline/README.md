# @outprep/fide-pipeline

Download, process, and seed FIDE player and game data from [This Week in Chess (TWIC)](https://theweekinchess.com/) PGN archives into PostgreSQL. Enriches players with official FIDE names, ratings, and federation data.

## Prerequisites

- Node.js 20+
- Docker (for local PostgreSQL)
- `unzip` command available (pre-installed on macOS/Linux)

## Setup

### 1. Environment variables

Copy the example env file from the project root and fill in your values:

```bash
cp .env.example .env
```

| Variable | Required for | How to get it |
|----------|-------------|---------------|
| `DATABASE_URL` | `seed-db`, `full`, `smoke`, cron jobs, the Next.js app | Local: `postgres://outprep:outprep@localhost:5432/outprep` (via Docker Compose). Production: your Neon / Supabase / Railway connection string. |

### 2. Start local PostgreSQL

```bash
docker compose up -d
```

This starts a Postgres 16 container and auto-creates all tables from `src/lib/db/schema.sql`. The database is persisted in a Docker volume.

> **Production:** Set `DATABASE_URL` to your hosted Postgres instance. Run the schema manually if tables don't exist — `seed-db` will create them automatically via `ensureSchema()`.

### 3. FIDE rating list (for name + rating enrichment)

The FIDE rating list is **downloaded automatically** by the pipeline when needed. You can also download it manually:

```bash
# Download (or update) the FIDE rating list
npm run fide-pipeline -- download-ratings

# Force re-download (e.g. after a monthly FIDE update)
npm run fide-pipeline -- download-ratings --force
```

The `process`, `full`, and `smoke` commands will also auto-download the rating list if it's not already present.

The zip contains one file (`players_list_foa.txt`) in fixed-width format with all three rating types per player row. The pipeline unzips to `/tmp` at runtime — the raw `.txt` file is never stored in the repo.

> **Without the FIDE zip**, the pipeline still works but uses abbreviated TWIC names
> (e.g. "Caruana,F" instead of "Caruana, Fabiano") and won't have official ratings.

## Quick Start

```bash
# Smoke test — download 1 TWIC issue, enrich with FIDE data (local only)
npm run fide-pipeline -- smoke --skip-upload

# Smoke test with Postgres seed
npm run fide-pipeline -- smoke
```

## Full Pipeline (seed database from scratch)

The pipeline has three phases: **download** → **process** → **seed-db**.

All data — including game PGN text — is stored in Postgres.

```bash
# All-in-one (downloads, processes, seeds Postgres):
npm run fide-pipeline -- full --from 1433 --to 1633

# Or run each step separately:
npm run fide-pipeline -- download --from 925 --to 1633
npm run fide-pipeline -- process --min-games 3
npm run fide-pipeline -- seed-db
```

### What `seed-db` does

Populates Postgres from processed data on disk (including PGN text for every game):

1. Creates all tables if they don't exist (`ensureSchema`) — includes idempotent migration to add `pgn` column
2. Upserts players (batch 100), player aliases (batch 200)
3. Drops game indexes → bulk-inserts games with PGN text (batch 500) → recreates indexes
4. Upserts game aliases (batch 500)
5. Tracks each run in `pipeline_runs`

The index drop/create optimization makes bulk game inserts ~10x faster by avoiding per-row index maintenance on 6 B-tree indexes during the insert.

### Interrupting and resuming

- **Postgres upserts are idempotent** — you can re-run `seed-db` safely. Existing rows are handled via `ON CONFLICT`.
- The `ON CONFLICT` clause also backfills PGN text for games that were inserted before the migration (i.e., rows where `pgn IS NULL`).

## Vercel Cron Jobs (automatic updates)

Two cron jobs are configured in `vercel.json` to keep data fresh in production:

| Cron job | Schedule | Route | What it does |
|----------|----------|-------|-------------|
| **TWIC update** | Every Monday at 6am UTC | `/api/cron/twic-update` | Checks for new TWIC issues since the last processed one and triggers an incremental pipeline |
| **FIDE ratings** | 1st of each month at 6am UTC | `/api/cron/fide-ratings` | Downloads the latest FIDE rating list and updates player ratings in Postgres |

Both routes use `maxDuration = 300` (5-minute timeout, requires Vercel Pro plan) and are authenticated via `CRON_SECRET` (set automatically by Vercel).

> **Current status:** The cron routes are **stubs** — they query `pipeline_runs` to report the last processed issue/update, but don't yet run the actual pipeline. Until fully implemented, run updates manually:
>
> ```bash
> # Weekly: add new TWIC issue(s)
> npm run fide-pipeline -- download --from <next> --to <next>
> npm run fide-pipeline -- process --min-games 3
> npm run fide-pipeline -- seed-db
>
> # Monthly: update FIDE ratings
> npm run fide-pipeline -- download-ratings --force
> npm run fide-pipeline -- process --min-games 3
> npm run fide-pipeline -- seed-db
> ```

## FIDE Enrichment

The pipeline enriches TWIC data with the official FIDE rating list:

| Before (TWIC only) | After (enriched) |
|---|---|
| Name: `Caruana,F` | Name: `Caruana, Fabiano` |
| Slug: `f-caruana-2020009` | Slug: `fabiano-caruana-2020009` |
| Rating: 2786 (from game) | Standard: 2795, Rapid: 2727, Blitz: 2769 |
| No federation | Federation: USA |

Old slugs (`f-caruana-2020009`) become aliases that 301-redirect to the canonical URL.

## CLI Reference

### `smoke`

End-to-end test with a single TWIC issue.

| Flag | Default | Description |
|------|---------|-------------|
| `--issue <n>` | 1633 | TWIC issue to test with |
| `--skip-upload` | false | Skip Postgres seed (local-only test) |

### `download`

Download TWIC zip files and extract PGN text.

| Flag | Default | Description |
|------|---------|-------------|
| `--from <n>` | required | First TWIC issue number |
| `--to <n>` | required | Last TWIC issue number |
| `--delay <ms>` | 500 | Delay between downloads (be polite to TWIC servers) |

### `download-ratings`

Download the official FIDE rating list (Standard/Rapid/Blitz). Also runs automatically during `process`, `full`, and `smoke` if the file is missing.

| Flag | Default | Description |
|------|---------|-------------|
| `--force` | false | Re-download even if the file already exists |

### `process`

Parse downloaded PGNs, aggregate player data, and enrich with FIDE ratings.

| Flag | Default | Description |
|------|---------|-------------|
| `--min-games <n>` | 3 | Minimum games for a player to be included |

### `seed-db`

Seed Postgres from processed data on disk (including PGN text). Creates tables if they don't exist. Drops and recreates game indexes around the bulk insert for speed.

Requires `DATABASE_URL`.

| Flag | Default | Description |
|------|---------|-------------|
| `--skip-to <step>` | — | Skip to: `schema`, `players`, `aliases`, `games`, `game-aliases` |

> Aliases: `seed`, `upload-pg` (for backwards compatibility)

### `seed-blob` *(deprecated)*

Previously uploaded game PGNs and per-player game files to Vercel Blob. PGN data is now stored directly in Postgres via `seed-db`. This command prints a deprecation notice and exits.

### `upload` *(deprecated)*

Previously uploaded all processed data to Vercel Blob. All data is now stored in Postgres via `seed-db`. This command prints a deprecation notice and exits.

### `full`

Download, process, and seed Postgres in one command. This is the recommended way to run the pipeline end-to-end — all data including PGNs ends up in Postgres.

| Flag | Default | Description |
|------|---------|-------------|
| `--from <n>` | required | First TWIC issue number |
| `--to <n>` | required | Last TWIC issue number |
| `--min-games <n>` | 3 | Minimum games per player |
| `--delay <ms>` | 500 | Delay between downloads |

## Database Schema

All player, game, and PGN data lives in PostgreSQL (see `src/lib/db/schema.sql`):

| Table | Replaces | Purpose |
|-------|----------|---------|
| `players` | `fide/players/*.json` + `fide/index.json` | Player profiles, ratings, stats, openings |
| `player_aliases` | `fide/aliases.json` | Old slug → canonical slug for 301 redirects |
| `games` | `fide/game-details/*.json` + `fide/game-index.json` + `fide/game-pgn/*.txt` | Game metadata + PGN text (TOAST-compressed) |
| `game_aliases` | `fide/game-aliases.json` | Legacy game slug → canonical slug |
| `pipeline_runs` | — | Tracks processed TWIC issues and FIDE rating updates |

## Data Storage Architecture

All data lives in **Postgres** — players, games, PGN text, aliases, and pipeline run metadata.

Game PGN text is stored in a `TEXT` column on the `games` table. Postgres automatically TOAST-compresses large text values, so ~3M games × 2-5KB PGN ≈ 3-9GB on disk (vs 6-15GB uncompressed).

This eliminates the need for Vercel Blob and enables:
- **SQL-based game search** (e.g., by opening, ECO code, player matchup)
- **Faster response times** (single DB query vs HTTP round-trip to Blob)
- **Simpler pipeline** (no separate `seed-blob` step)
- **Self-sufficient `full` command** (download → process → seed-db, done)

> **Migration note:** Vercel Blob was previously used for game PGN text (`fide/game-pgn/`) and per-player game arrays (`fide/games/`). These prefixes are now listed in `scripts/purge-deprecated-blobs.ts` for cleanup.

### URL Slug Design

**Canonical slug** = `{firstname}-{lastname}-{fideId}`:
- `"Caruana, Fabiano"` → `/player/fabiano-caruana-2020009`
- `"Carlsen, Magnus"` → `/player/magnus-carlsen-1503014`

**Aliases** (301 redirect to canonical):
- `f-caruana-2020009` → old TWIC abbreviated slug
- `caruana-fabiano-2020009` → lastname-first order
- `caruana-f` → short form without FIDE ID

## Adding New TWIC Issues

To add the latest weekly issue:

```bash
# Download just the new issue
npm run fide-pipeline -- download --from 1634 --to 1634

# Re-process all downloaded data (includes FIDE enrichment)
npm run fide-pipeline -- process --min-games 3

# Seed Postgres (players, games, PGNs — all in one step)
npm run fide-pipeline -- seed-db
```

## Troubleshooting

### "DATABASE_URL not set" or connection errors

Make sure Docker is running (`docker compose up -d`) and your `.env` has the correct `DATABASE_URL`. For production, check your Neon/Supabase connection string.

### "No .pgn file found in zip archive"

Some TWIC issues may have non-standard zip structure. The download script skips failed issues and continues.

### "Zip not found" for FIDE enrichment

If you see `[fide-enrichment] Zip not found`, run `npm run fide-pipeline -- download-ratings` to fetch the FIDE rating list. The pipeline normally auto-downloads this, but network issues may prevent it. The pipeline still works without it, just with abbreviated names.

### Large data directory

Downloaded PGN files are cached in `packages/fide-pipeline/data/`. Delete the `data/` directory to free disk space after seeding.

### Backfilling PGN for existing games

If your database was seeded before the PGN migration, re-run `seed-db` with the same `game-details.jsonl` on disk. The `ON CONFLICT` clause uses `SET pgn = EXCLUDED.pgn WHERE games.pgn IS NULL` to backfill PGN for existing rows without touching other columns.
