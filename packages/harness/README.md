# @outprep/harness

Accuracy test harness for the Outprep chess bot engine. Replays real Lichess games position-by-position and measures how closely the bot mimics the original player's moves.

## Prerequisites

- Node.js 18+
- npm workspaces set up at the repo root (`npm install`)

## Quick Start

```bash
# 1. Create a test dataset from a Lichess player
npm run harness:create -- -u DrNykterstein -n 200

# 2. Run the accuracy test (baseline)
npm run harness:run -- -d DrNykterstein --label baseline

# 3. Experiment with config changes
npm run harness:run -- -d DrNykterstein --label high-temp \
  -c '{"boltzmann":{"temperatureScale":25}}'

# 4. Compare results side-by-side
npm run harness:compare -- baseline high-temp

# 5. Visualize in the dashboard
npm run dashboard
# Then drag result JSON files onto the page
```

## Commands

All commands can be run from the repo root via `npm run harness -- <command>` or the shorthand scripts.

### `create-dataset`

Fetches games from the Lichess API and saves them as a reusable test dataset.

```bash
npm run harness:create -- -u <username> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-u, --username <name>` | Lichess username (required) | -- |
| `-n, --max-games <n>` | Maximum games to fetch | 200 |
| `-s, --speeds <list>` | Comma-separated: bullet,blitz,rapid,classical | blitz,rapid |
| `-o, --output <name>` | Dataset filename | username |

Datasets are saved to `packages/harness/datasets/<name>.json` (gitignored).

### `run`

Runs the bot against every player-move position in a dataset and records the results.

```bash
npm run harness:run -- -d <dataset> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-d, --dataset <name>` | Dataset name or path (required) | -- |
| `-c, --config <json>` | BotConfig overrides as JSON string | -- |
| `--seed <n>` | Random seed for reproducibility | 42 |
| `--label <label>` | Human-readable label for this run | unnamed |
| `--elo-override <n>` | Override player Elo for bot creation | dataset Elo |
| `--max-positions <n>` | Cap positions to evaluate (for quick iteration) | all |

Results are saved to `packages/harness/results/<dataset>-<label>-<timestamp>.json` (gitignored).

**Config overrides** are deep-merged with `DEFAULT_CONFIG`. You only need to specify the fields you want to change:

```bash
# Only changes boltzmann.temperatureScale; other boltzmann fields (multiPvCount, temperatureFloor) stay at defaults
npm run harness:run -- -d player --label test -c '{"boltzmann":{"temperatureScale":25}}'
```

### `compare`

Prints a side-by-side metrics comparison for two or more runs.

```bash
npm run harness:compare -- <label1> <label2> [label3...]
```

Accepts result labels (matches most recent file containing the label), filenames, or full paths.

## Metrics

| Metric | Description |
|--------|-------------|
| **Match Rate** | Exact move match: bot picked the same move as the player |
| **Top-4 Rate** | Player's actual move was in the engine's top 4 candidates |
| **Book Coverage** | Fraction of positions where the bot used the opening trie |
| **Actual CPL** | Player's average centipawn loss (from Lichess eval data) |
| **Bot CPL** | Bot's average centipawn loss (from engine candidate scores) |
| **CPL Delta** | |Bot CPL - Actual CPL| — lower means the bot's error rate is closer to the player's |

## Version Traceability

Every result JSON includes version metadata so you can trace exactly which code and config produced the results:

```json
{
  "version": {
    "gitCommit": "6f63c4c",
    "gitDirty": false,
    "engineVersion": "0.1.0",
    "harnessVersion": "0.1.0",
    "stockfishVersion": "^18.0.5"
  },
  "resolvedConfig": {
    "elo": { "min": 1100, "max": 2800 },
    "skill": { "min": 0, "max": 20 },
    "boltzmann": { "multiPvCount": 4, "temperatureFloor": 0.1, "temperatureScale": 25 },
    ...
  }
}
```

- **gitCommit** — The exact commit that ran. Use `git checkout <commit>` to reproduce.
- **gitDirty** — If `true`, there were uncommitted changes. The result may not be exactly reproducible from the commit alone.
- **resolvedConfig** — The full merged config (`DEFAULT_CONFIG` + your overrides). Even if `DEFAULT_CONFIG` changes between engine versions, this snapshot tells you exactly what ran.
- **configOverrides** — Also preserved (the delta you passed via `-c`) for quick diffing.

### Reproducing a run

```bash
git checkout <gitCommit from result>
npm install
npm run harness:run -- -d <dataset> --seed <seed> --label repro \
  -c '<configOverrides from result>'
```

With the same seed and config, the seeded PRNG produces identical bot behavior.

## Dashboard

The companion dashboard (`packages/dashboard`) visualizes results across iterations:

```bash
npm run dashboard
```

Open http://localhost:5180 and drag result JSON files onto the page. The dashboard shows:

- **Overview** — Summary cards, comparison table, config diff
- **Phase Breakdown** — Match rate by opening/middlegame/endgame
- **CPL Analysis** — Actual vs bot CPL, delta comparison
- **Accuracy** — Stacked breakdown: exact match / top-4 / miss
- **Trends** — Metrics over time across multiple runs

Each card displays the engine version and git commit for traceability.

## Workflow: Iterating on the Engine

1. Create a dataset once: `npm run harness:create -- -u <player> -n 200`
2. Run a baseline: `npm run harness:run -- -d <player> --label baseline`
3. Make a code change in `packages/engine/`
4. Run again: `npm run harness:run -- -d <player> --label <descriptive-name>`
5. Compare: `npm run harness:compare -- baseline <descriptive-name>`
6. Load both in the dashboard for visual comparison
7. The git commit in each result tells you exactly which code version produced it

## Performance

At ~100ms per Stockfish eval, 200 games with ~20 player moves each takes ~7 minutes. Use `--max-positions <n>` for quick iteration (e.g., `--max-positions 50` takes ~10s).

## Project Structure

```
packages/harness/
  src/
    cli.ts                    # Commander CLI entry point
    commands/
      create-dataset.ts       # Fetch games from Lichess
      run.ts                  # Run accuracy test
      compare.ts              # Compare result files
    node-stockfish.ts         # Stockfish WASM adapter (Node.js)
    runner.ts                 # Core: replay games, collect bot predictions
    metrics.ts                # Aggregate metric computation
    version.ts                # Git/version metadata capture
    seeded-random.ts          # Deterministic PRNG (xoshiro128**)
    format.ts                 # CLI tables and progress bars
    lichess-fetch.ts          # Lichess API client
    lichess-adapters.ts       # LichessGame -> engine types
    lichess-types.ts          # Lichess API types
    types.ts                  # Harness type definitions
  datasets/                   # .gitignored — created at runtime
  results/                    # .gitignored — created at runtime
```
