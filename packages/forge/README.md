# @outprep/forge

Autonomous chess engine research lab. An AI agent (Claude) iteratively modifies `@outprep/engine` code and configuration to improve human move prediction accuracy, guided by Maia-aligned metrics.

## How It Works

1. **Baseline** — Download player games from Lichess, split into train/test sets, measure current accuracy
2. **Research loop** — Claude proposes code/config changes in a sandboxed worktree, evaluates them against the test set, keeps improvements
3. **Convergence** — The agent stops after a plateau (no improvement in N experiments), a cost budget, or max experiments

All player profiles (error profile, opening trie, style metrics) are built from **train games only**. Accuracy is measured on held-out **test games** to prevent data leakage.

## Setup

```bash
cp .env.example .env
# Add your ANTHROPIC_API_KEY (required)
# Add OPENAI_API_KEY (optional, for oracle)
```

## Commands

```bash
# Compute baseline metrics for one or more players
npm run forge -- baseline --players "penguingim1" --seed 42

# Start an autonomous research session
npm run forge -- research \
  --name "session-1" \
  --players "Fins,Rodigheri" \
  --focus accuracy \
  --max-experiments 20 \
  --seed 42

# Resume a paused session
npm run forge -- resume <session-id>

# Check status of active session
npm run forge -- status

# List past sessions and results
npm run forge -- history

# Ask the oracle (Claude → ChatGPT → Claude pipeline)
npm run forge -- oracle "What temperature curve works best for 1500 Elo?"
```

## Key Metrics

| Metric | Weight | Description |
|--------|--------|-------------|
| Move prediction accuracy | 50% | Top-1 match rate on held-out test positions |
| CPL distribution match | 20% | KL divergence between bot and player centipawn loss distributions |
| Blunder rate profile | 15% | Per-phase blunder/mistake rate delta |
| Other (book personality) | 15% | Opening repertoire match, style similarity |

## Architecture

```
src/
├── cli.ts              # Entry point (commander)
├── agent/              # Autonomous research loop (Claude)
│   ├── agent-loop.ts   # Main orchestration
│   ├── system-prompt.ts
│   ├── convergence.ts
│   ├── cost-tracker.ts
│   └── tool-handler.ts
├── repl/               # Sandboxed eval environment
│   ├── forge-api.ts    # forge.* API surface
│   ├── eval-ops.ts     # forge.eval.run(), baseline()
│   ├── _eval-worker.ts # Subprocess for harness evals
│   ├── code-ops.ts     # forge.code.patch(), read()
│   ├── config-ops.ts   # forge.config.get(), set()
│   ├── session-ops.ts
│   └── sandbox.ts      # Git worktree sandbox
├── metrics/            # Maia-aligned scoring
│   ├── maia-scorer.ts  # Composite scorer + baseline
│   ├── move-accuracy.ts
│   ├── cpl-distribution.ts
│   ├── blunder-profile.ts
│   └── significance.ts # Bootstrap CI, permutation tests
├── data/               # Player data & caching
│   ├── game-store.ts   # Lichess download + local cache
│   ├── splits.ts       # Deterministic train/test splits
│   └── eval-cache.ts   # Position eval cache (SQLite)
├── state/              # Session persistence
│   ├── types.ts
│   └── forge-state.ts
├── oracle/             # Multi-model consultation
│   ├── oracle.ts
│   └── clients.ts
├── knowledge/          # Topic-based knowledge base
│   └── index.ts
└── log/                # Experiment logging & trends
    ├── log-formatter.ts
    ├── trend-tracker.ts
    └── experiment-log.ts
```

## Train/Test Methodology

- **Split**: 80% train / 20% test (deterministic, seed-based)
- **Profiles from train only**: Error profile, opening trie, style metrics
- **Evaluation on test only**: Move accuracy, CPL, blunder rates
- **Phase-balanced sampling**: 40% opening, 40% middlegame, 20% endgame
- **Statistical rigor**: Bootstrap 95% CIs, paired permutation tests (p < 0.05)
