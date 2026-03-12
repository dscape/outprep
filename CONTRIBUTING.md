# Contributing to outprep

Thanks for your interest in contributing. This document covers how to get set up and how we work together.

## Getting started

```bash
git clone https://github.com/dscape/outprep.git
cd outprep

# Start local PostgreSQL
docker compose up -d

# Install dependencies
npm install

# Set up environment
cp .env.example .env

# Seed the database with sample data
npm run fide-pipeline -- smoke

# Start the dev server
npm run dev
```

This installs all workspace dependencies, copies the Stockfish WASM files to `public/`, seeds the local database, and starts the app at [http://localhost:3000](http://localhost:3000).

## Project layout

```
src/                    Next.js app (pages, API routes, components)
packages/
  engine/               Core bot logic (pure TypeScript, no framework deps)
  fide-pipeline/        TWIC/FIDE data pipeline (download, parse, seed Postgres)
  harness/              CLI for accuracy testing against real games
  forge/                Autonomous research agent (uses Claude API)
```

The `engine` package is the foundation — it has no dependencies on Next.js or the UI. The `harness` and `forge` build on top of it. The main app in `src/` ties everything together.

## Working with the database

The local database is PostgreSQL 16, started via `docker compose up -d`. The schema is in `src/lib/db/schema.sql` and is applied automatically when the container first starts.

To seed with full data (80K+ players, 3M+ games), see the README's "Full data setup" section.

Useful commands:
```bash
# Check database tables
docker compose exec postgres psql -U outprep -d outprep -c "\dt"

# Query player count
docker compose exec postgres psql -U outprep -d outprep -c "SELECT COUNT(*) FROM players"

# Reset database (drops all data)
docker compose down -v && docker compose up -d
```

## Working with the pipeline

The `fide-pipeline` package downloads TWIC chess game data, enriches it with FIDE ratings, and seeds PostgreSQL:

```bash
# Quick smoke test (1 issue)
npm run fide-pipeline -- smoke

# Download new TWIC issues
npm run fide-pipeline -- download --from 1634 --to 1634

# Process all PGN files
npm run fide-pipeline -- process --min-games 3

# Seed the database
npm run fide-pipeline -- seed-db
```

## How to contribute

### Reporting bugs

Open an [issue](https://github.com/dscape/outprep/issues). Include:

- What you expected to happen
- What actually happened
- Steps to reproduce
- Browser/Node version if relevant

### Suggesting improvements

Open an [issue](https://github.com/dscape/outprep/issues) describing the improvement. Even vague ideas are welcome — we can figure out the details together.

### Submitting changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `npm run lint` and fix any issues
4. Test your changes locally with `npm run dev`
5. Open a pull request

Keep PRs focused. One concern per PR is ideal. If you're making a large change, open an issue first so we can discuss the approach.

## Code style

- TypeScript everywhere, strict mode
- Tailwind CSS for styling
- Prefer small, focused functions
- Follow the patterns you see in existing code

The project uses ESLint with Next.js and TypeScript rules. Run `npm run lint` to check.

## Working with the engine

The bot's behavior is entirely driven by `BotConfig` in `packages/engine/src/types.ts`. The default values live in `packages/engine/src/config.ts`. If you're tuning behavior, that's where to look.

To test changes to the engine against real games:

```bash
# Create a dataset
npm run harness:create -- --username SomePlayer --games 20

# Run the test
npm run harness:run -- --dataset datasets/SomePlayer.json
```

This gives you match rate, top-4 rate, and CPL delta metrics to measure the impact of your changes.

## Working with the forge

The forge is an autonomous research agent that uses the Claude API to iteratively improve bot accuracy. To use it, you need an `ANTHROPIC_API_KEY` in your `.env`:

```bash
# Add to .env (required for forge CLI and forge dashboard session launcher)
ANTHROPIC_API_KEY=sk-ant-...
```

Without this key, forge sessions will fail immediately — both from the CLI and the web dashboard at `/forge`.

```bash
# Start a research session from the CLI
npm run forge -- research --players "SomePlayer" --focus accuracy

# Or use the web dashboard (requires the dev server running)
npm run dev
# Then visit http://localhost:3000/forge and click "New Session"
```

Each session runs in an isolated git worktree. Use `npm run forge -- ls` to list sessions and `npm run forge -- clean` to remove them.

## Questions?

Open an issue. There are no dumb questions.
