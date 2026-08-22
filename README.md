# outprep

Scout any chess player, study their openings and weaknesses, then practice against a bot that plays like them.

Enter a Lichess username or drop a PGN file, and outprep builds a profile of the player's repertoire, tendencies, and mistakes. Practice follows the player’s personal opening book, then uses Maia-3 for human-like out-of-book moves. Stockfish remains responsible for evaluation, analysis, and a disclosed failure fallback.

## Prerequisites

- [Node.js](https://nodejs.org) 20+
- [Docker](https://docs.docker.com/get-docker/) (for local PostgreSQL)

## Quick start

```bash
# 1. Start the local database
docker compose up -d

# 2. Install dependencies (copies Stockfish WASM to public/ automatically)
npm install

# 3. Set up environment
cp .env.example .env

# 4. Seed the database with sample data (1 TWIC issue, ~1 min)
npm run fide-pipeline -- smoke

# 5. Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Enter a Lichess username and hit **Scout**, or browse FIDE player pages.

### Full data setup

For the complete dataset (~80K players, 3M+ games), either:

**Option A** — Extract from a TWIC archive (fastest):
```bash
# Get the archive from a team member, then:
mkdir -p packages/fide-pipeline/data/ratings
cd packages/fide-pipeline/data
unzip /path/to/twic-archive-YYYYMMDD.zip
mv players_list.zip ratings/
cd ../../..

# Process and seed
npm run fide-pipeline -- process --min-games 3
npm run fide-pipeline -- seed-db
```

**Option B** — Download from source (~1 hour download):
```bash
npm run fide-pipeline -- full --from 924 --to 1633
```

## How it works

1. **Scout** a player — fetches their recent games from the Lichess API
2. **Analyze** their openings, weaknesses, and error patterns
3. **Play** against a bot calibrated to their Elo, opening book, and mistake profile

The personal opening trie is always first priority. Out of book, a browser Web Worker runs Maia-3 with legal-move masking and both players’ calibrated ratings. The board shows the model input as an approximate FIDE equivalent so its target is clear; this is a calibration, not a guaranteed playing strength. Stockfish evaluates the game in parallel and is used for play only when Maia is disabled or fails; that fallback is shown in the UI.

## Project structure

This is an npm workspaces monorepo:

```
src/                    Next.js app (frontend + API routes)
packages/
  engine/               Core bot logic (move selection, config, types)
  fide-pipeline/        TWIC/FIDE data pipeline (download, parse, seed Postgres)
  harness/              CLI to replay positions and measure bot accuracy
```

### `@outprep/engine`

Reusable TypeScript library. It defines the strict opening-trie → `MovePolicy` → `ChessEngine` ordering, Maia-3 preprocessing and legal-move masking, plus the existing error profiling, phase detection, Stockfish fallback, and move-style utilities.

### `@outprep/fide-pipeline`

CLI tool that downloads TWIC (The Week in Chess) PGN files, enriches players with official FIDE ratings, and seeds PostgreSQL.

```bash
# Full pipeline: download, process, and seed
npm run fide-pipeline -- full --from 924 --to 1633

# Individual steps
npm run fide-pipeline -- download --from 1634 --to 1634
npm run fide-pipeline -- download-ratings --force
npm run fide-pipeline -- process --min-games 3
npm run fide-pipeline -- seed-db

# Quick smoke test (1 TWIC issue)
npm run fide-pipeline -- smoke

# Preview/apply configured player erasures
npm run fide-pipeline -- purge-excluded
npm run fide-pipeline -- purge-excluded --apply
```

### `@outprep/harness`

CLI tool that replays held-out player games and measures how closely the bot mimics the player. It reports book coverage, out-of-book match rate, Maia coverage, Stockfish fallback count, top-4 rate, and CPL delta.

```bash
# Create a test dataset from a Lichess player
npm run harness:create -- --username DrNykterstein --games 20

# Run the existing engine accuracy test
npm run harness:run -- --dataset datasets/DrNykterstein.json

# Benchmark Maia-3 on out-of-book positions
npm run harness:run -- --dataset datasets/DrNykterstein.json \
  --maia-model public/models/maia3-simplified.onnx

# Compare two result files side by side
npm run harness:compare -- results/a.json results/b.json
```

## Database

outprep uses PostgreSQL 16 for all player and game data. The schema (`src/lib/db/schema.sql`) creates the core tables:

- **players** — 80K+ FIDE-rated players with ratings, openings, recent games
- **player_aliases** — slug redirects for old/alternative player URLs
- **games** — 3M+ OTB games with full PGN text (TOAST-compressed)
- **game_aliases** — legacy game slug redirects
- **events** — aggregated tournament/event data derived from games
- **online_profiles** — cached Lichess/Chess.com player profiles
- **pipeline_runs** — tracks processed TWIC issues and FIDE rating updates

Local development uses Docker (`docker compose up -d`), which auto-runs `schema.sql` on first start. Production uses any Postgres host (Neon, Supabase, Railway).

### Migrations

Schema migrations are applied automatically by `npm run fide-pipeline -- seed-db` (via `ensureSchema()` in `packages/fide-pipeline/src/upload-pg.ts`). All migrations are idempotent — they use `IF NOT EXISTS` and column-existence checks, so they're safe to run repeatedly. Migration files live in `src/lib/db/migrations/`.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the Next.js dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run fide-pipeline -- smoke` | Quick data test (1 TWIC issue) |
| `npm run fide-pipeline -- full --from N --to N` | Full pipeline: download + process + seed |
| `npm run fide-pipeline -- seed-db` | Seed Postgres from processed data |
| `npm run twic-archive` | Create a TWIC data archive for dev bootstrapping |
| `npm run harness:create` | Create a test dataset from Lichess |
| `npm run harness:run` | Run accuracy test |
| `npm run harness:compare` | Compare two result sets |

## Tech stack

- [Next.js](https://nextjs.org) 16 + React 19 + Tailwind CSS 4
- [PostgreSQL](https://www.postgresql.org) 16 via [porsager/postgres](https://github.com/porsager/postgres)
- [chess.js](https://github.com/jhlywa/chess.js) for move generation and validation
- [Maia-3](https://github.com/CSSLab/maia3) via ONNX Runtime Web for out-of-book play
- [Stockfish](https://stockfishchess.org) 18 WASM for evaluation, analysis, and failure fallback
- [react-chessboard](https://github.com/Clariity/react-chessboard) for board UI
- [Lichess API](https://lichess.org/api) for player data

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Suggestions and bug reports are welcome on the [issue tracker](https://github.com/dscape/outprep/issues).

## Licensing

Outprep’s original code is released into the public domain under [UNLICENSE](UNLICENSE). Bundled third-party code and model weights retain their own licenses, including Maia-3 under AGPL-3.0, the referenced Maia frontend under GPL-3.0, and ONNX Runtime under MIT. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [`licenses/`](licenses/) before redistributing or operating a modified network service.

---

Made with love in Porto.
