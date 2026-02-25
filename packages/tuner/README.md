# @outprep/tuner

Autonomous engine accuracy improvement agent. Gathers data from diverse Lichess players, sweeps config parameters, uses Claude to analyze results, and proposes improvements — pausing for human review at each cycle.

## Prerequisites

- Node.js 18+
- npm workspaces set up at the repo root (`npm install`)
- **`ANTHROPIC_API_KEY`** environment variable (required)

The tuner uses the Claude API to analyze experiment results and synthesize recommendations. Without a valid API key, the program will refuse to run.

The easiest way to configure your key is with a `.env` file:

```bash
cd packages/tuner
cp .env.example .env
# Edit .env and paste your API key
```

Alternatively, export it in your shell:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

## Quick Start

```bash
# 1. Set your API key (see Prerequisites above)
cp packages/tuner/.env.example packages/tuner/.env
# Edit packages/tuner/.env and paste your key

# 2. Run a full tuning cycle
npm run tuner -- start

# The tuner will:
#   1. Fetch games from players across 5 Elo bands
#   2. Run ~25 parameter experiments against all datasets
#   3. Send results to Claude for analysis
#   4. Generate a proposal with recommendations
#   5. Pause and wait for your review

# 3. Review the proposal
cat packages/tuner/proposals/*/proposal.md

# 4. Accept or reject
npm run tuner -- accept    # Updates DEFAULT_CONFIG in engine
npm run tuner -- reject    # Archives proposal, keeps current config

# 5. Repeat
npm run tuner -- start
```

## Commands

All commands run from the repo root via `npm run tuner -- <command>`.

### `start`

Runs a full tuning cycle: gather → sweep → analyze → proposal. Resumes from wherever the state machine left off.

```bash
npm run tuner -- start [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--skip-gather` | Reuse existing datasets | off |
| `--force-gather` | Reset player pool to seeds and re-gather all datasets | off |
| `--max-experiments <n>` | Cap experiments per sweep | 25 |
| `--triage-positions <n>` | Positions for quick triage runs | 15 |
| `--full-positions <n>` | Positions for full validation (0 = unlimited) | 0 |
| `--seed <n>` | Base random seed | 42 |

### `gather`

Fetches games from Lichess players across Elo bands.

```bash
npm run tuner -- gather [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--max-games <n>` | Games per player | 100 |
| `--speeds <list>` | Comma-separated speed filters | blitz,rapid |

### `sweep`

Runs parameter experiments against all datasets.

```bash
npm run tuner -- sweep [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--max-experiments <n>` | Cap total experiments | 25 |
| `--triage-positions <n>` | Positions for triage runs | 15 |
| `--full-positions <n>` | Positions for full validation (0 = unlimited) | 0 |
| `--seed <n>` | Base random seed | 42 |

### `analyze`

Sends sweep results to Claude for analysis, generates a proposal.

```bash
npm run tuner -- analyze
```

### `accept`

Accepts the current proposal and updates `DEFAULT_CONFIG` in `packages/engine/src/config.ts`.

```bash
npm run tuner -- accept
```

### `reject`

Rejects the current proposal and archives it.

```bash
npm run tuner -- reject
```

### `status`

Prints current tuner state and progress. Does not require `ANTHROPIC_API_KEY`.

```bash
npm run tuner -- status
```

### `history`

Prints all past tuning cycles and accepted changes. Does not require `ANTHROPIC_API_KEY`.

```bash
npm run tuner -- history
```

## How It Works

### Tuning Cycle

```
GATHER → SWEEP → ANALYZE → PROPOSAL → (human review) → ACCEPT/REJECT → repeat
```

1. **Gather**: Fetches games from Lichess players stratified by Elo band:

   | Band | Elo Range | Players |
   |------|-----------|---------|
   | Beginner | 1100-1400 | 2 |
   | Intermediate | 1400-1700 | 2 |
   | Advanced | 1700-2000 | 2 |
   | Expert | 2000-2300 | 2 |
   | Master | 2300+ | 1 |

2. **Sweep**: Tests config variations one parameter at a time. Each experiment modifies a single parameter from the current best config. Quick triage runs (~15 positions) filter candidates before full validation.

3. **Analyze**: Sends all experiment results to Claude (Sonnet) for synthesis. Claude ranks improvements, proposes a combined config, and suggests code-level improvements.

4. **Proposal**: Writes `proposal.md` and `proposal.json` to `proposals/<timestamp>/`, then pauses for human review.

### Composite Score

Experiments are ranked by a single composite metric (higher = better):

| Weight | Metric | Description |
|--------|--------|-------------|
| 30% | Match Rate | Bot picked the same move as the player |
| 25% | Top-4 Rate | Player's move was in engine's top 4 candidates |
| 25% | CPL Delta | Bot's error pattern matches the player's (lower = better) |
| 10% | Book Coverage | Fraction of positions using opening trie |
| 10% | CPL Similarity | Absolute CPL proximity between bot and player |

### Parameter Registry

Parameters are tested in priority order (most impactful first):

| Priority | Parameter | Impact |
|----------|-----------|--------|
| 1 | `boltzmann.temperatureScale` | Critical |
| 2 | `depthBySkill` | Critical |
| 3 | `dynamicSkill.scale` | High |
| 4 | `dynamicSkill.perfectPhaseBonus` | High |
| 5 | `error.mistake` / `error.blunder` | Medium |
| 6 | `dynamicSkill.minOverallMoves` | Medium |
| 7 | `trie.minGames` | Medium |
| 8 | `boltzmann.temperatureFloor` | Medium |
| 9 | `boltzmann.multiPvCount` | Low |
| 10 | `phase.openingAbove` / `endgameAtOrBelow` | Low |

## State & Resume

The tuner maintains state in `tuner-state.json` (gitignored). State is checkpointed after every experiment, so you can stop and resume at any point:

```bash
# Interrupt with Ctrl+C, then resume later:
npm run tuner -- start
```

The state machine tracks: current cycle, phase (gather/sweep/analyze/waiting), player pool, datasets, sweep plan progress, best config, and history.

## Player Pool

The tuner ships with seed players across Elo bands. You can edit `tuner-state.json` to add or remove players:

```json
{
  "playerPool": [
    { "username": "your_player", "band": "intermediate", "estimatedElo": 1550 }
  ]
}
```

Datasets are cached for 7 days before being re-fetched.

## Performance

- **Triage run** (~15 positions, top-N eval skipped): ~3-5s per experiment
- **Full validation** (~200 games, unlimited positions): ~7 min per experiment
- **Full cycle** (gather + 25 triage experiments + analysis): ~15-30 min
- **Lichess API**: Rate-limited to 1.5s between calls

## Project Structure

```
packages/tuner/
  src/
    cli.ts                        # Commander CLI entry point + API key gate
    commands/
      start.ts                    # Full cycle orchestration
      gather.ts                   # Data collection phase
      sweep.ts                    # Parameter sweep phase
      analyze.ts                  # Claude API analysis
      accept.ts                   # Accept proposal, update DEFAULT_CONFIG
      reject.ts                   # Reject and archive proposal
      status.ts                   # Print current state
      history.ts                  # Print cycle history
    loop/
      sweep-planner.ts            # Generate experiment specs
      experiment-runner.ts        # Run experiments via harness
      result-aggregator.ts        # Aggregate metrics across datasets
    analysis/
      prompt-builder.ts           # Build Claude API prompts
      report-generator.ts         # Parse response, write proposal files
    data/
      player-pool.ts              # Elo-stratified player management
      dataset-manager.ts          # Batch dataset creation
    scoring/
      composite-score.ts          # Weighted metric combination
    state/
      tuner-state.ts              # State persistence (load/save/checkpoint)
      types.ts                    # All tuner-specific type definitions
    util/
      parameter-registry.ts       # Priority-ordered tunable parameters
      config-perturbation.ts      # Generate config variants
  proposals/                      # .gitignored — generated proposals
  experiments/                    # .gitignored — datasets and results
  tuner-state.json                # .gitignored — persistent state
```
