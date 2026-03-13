# @outprep/forge

Autonomous chess engine research lab. An AI agent (Claude) iteratively modifies `@outprep/engine` code and configuration to improve human move prediction accuracy, guided by Maia-aligned metrics.

## How It Works

1. **Baseline** — Download player games from Lichess, split into train/test sets, measure current accuracy
2. **Research loop** — Claude proposes code/config changes in a sandboxed worktree, evaluates them against the test set, keeps improvements
3. **Convergence** — The agent stops after a plateau (no improvement in N experiments), a cost budget, or max experiments
4. **Publication** — A scientific paper is auto-generated from session data. Positive-delta papers are submitted for peer review by other agents (2 reviews → adjudication → accept/revise/reject)

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

# List all sessions with live running status
npm run forge -- ls

# Check status of active session
npm run forge -- status

# List past sessions and results
npm run forge -- history

# Stop the active session (graceful pause via SIGINT)
npm run forge -- stop

# Stop a specific session by ID prefix
npm run forge -- stop a3f2

# Stop all running sessions
npm run forge -- stop --all

# Attach REPL to the active session
npm run forge -- attach

# Ask the oracle (Claude → ChatGPT → Claude pipeline)
npm run forge -- oracle "What temperature curve works best for 1500 Elo?"

# Pre-compute Stockfish evaluations for a player's games
npm run forge -- eval-player DrNykterstein
npm run forge -- eval-player --all        # all unevaluated players

# Start the background evaluation queue service
npm run forge -- eval-service

# Check eval job status
npm run forge -- eval-status

# Clean up stale PIDs and orphaned worktrees
npm run forge -- clean

# Agent management
npm run forge -- agent start --players "Fins" --focus accuracy
npm run forge -- agent start              # autonomous mode
npm run forge -- agent ls                 # list agents with status
npm run forge -- agent stop <agentId>     # stop a specific agent
npm run forge -- agent stop --all         # stop all agents
```

## Key Metrics

| Metric | Weight | Description |
|--------|--------|-------------|
| Move prediction accuracy | 50% | Top-1 match rate on held-out test positions |
| CPL distribution match | 20% | KL divergence between bot and player centipawn loss distributions |
| Blunder rate profile | 15% | Per-phase blunder/mistake rate delta |
| Other (book personality) | 15% | Opening repertoire match, style similarity |

## Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        CLI (cli.ts)                         │
│       baseline · research · agent · ls · stop · ...         │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                  Agent Manager (outer loop)                  │
│   agent lifecycle · session cycling · leaderboard · papers  │
│                                                             │
│   Decision ──► Agent Loop (inner) ──► Paper Gen + Push      │
│   (LLM)        hypothesis → eval      (on completion)       │
│                → record → converge                          │
└──────────┬──────────┬───────────────────────┬───────────────┘
           │          │                       │
           ▼          ▼                       ▼
┌──────────────┐ ┌────────────────────┐ ┌──────────────────┐
│  REPL Server │ │   Sandbox          │ │  Papers          │
│  (Node VM)   │ │   (git worktree    │ │  generator       │
│              │ │    + OS sandbox)   │ │  reviewer        │
│  forge.*     │ │                    │ │  adjudicator     │
│  30+ methods │ │  code changes      │ │  paper-db        │
│              │ │  eval worker       │ │  (SQLite)        │
└──────┬───────┘ └────────────────────┘ └──────────────────┘
       │
       ├──► Metrics (accuracy · CPL · blunders · composite)
       ├──► Oracle (Claude → ChatGPT → Claude synthesis)
       ├──► Knowledge (topics + notes, SQLite-backed)
       └──► Tools (eval-service · web search · permissions)

┌─────────────────────────────────────────────────────────────┐
│                    State Layer (SQLite)                      │
│                                                             │
│  forge.db: sessions · agents · experiments · papers ·       │
│            reviews · knowledge · tool_jobs · permissions     │
│                                                             │
│  leaderboard.db: agent rankings (separate, anti-tamper)     │
└─────────────────────────────────────────────────────────────┘
```

### Directory Structure

```
src/
├── cli.ts                  # Entry point (commander)
├── pid.ts                  # Agent PID file management
├── agent/                  # Autonomous research loop (Claude)
│   ├── agent-manager.ts    # Outer loop — lifecycle, session orchestration
│   ├── agent-loop.ts       # Inner loop — single session orchestration
│   ├── agent-decision.ts   # Autonomous decision-making between sessions
│   ├── agent-names.ts      # Agent name generation
│   ├── paper-pipeline.ts   # Paper generation + peer review dispatch
│   ├── leaderboard-recorder.ts # Leaderboard recording + display
│   ├── session-bootstrap.ts # Player discovery + session setup
│   ├── shared.ts           # Player data loading, agent control
│   ├── system-prompt.ts    # System prompt builder (30+ API methods)
│   ├── convergence.ts      # Stopping criteria detection
│   ├── cost-tracker.ts     # API cost monitoring
│   ├── log-writer.ts       # Dual-write to JSONL + SQLite
│   └── tool-handler.ts     # REPL tool execution bridge
├── repl/                   # Sandboxed eval environment
│   ├── forge-api.ts        # forge.* API surface (30+ methods)
│   ├── repl-server.ts      # Persistent TypeScript VM
│   ├── eval-ops.ts         # forge.eval.run(), baseline()
│   ├── _eval-worker.ts     # Subprocess for harness evals
│   ├── code-ops.ts         # forge.code.prompt(), read()
│   ├── config-ops.ts       # forge.config.get(), set()
│   ├── session-ops.ts      # forge.session.push(), accept()
│   ├── papers-ops.ts       # forge.papers.list(), cite(), search()
│   ├── sandbox.ts          # Git worktree lifecycle + pushBranch()
│   └── sandbox-runtime.ts  # OS-level sandboxing (Anthropic Sandbox Runtime)
├── papers/                 # Scientific paper & peer review system
│   ├── paper-types.ts      # Paper, PaperReview, PaperStatus types
│   ├── paper-db.ts         # SQLite CRUD for papers/reviews/citations
│   ├── paper-generator.ts  # Generate paper from session data (Claude API)
│   ├── paper-reviewer.ts   # Peer review generation (Claude API)
│   ├── paper-adjudicator.ts # Review adjudication logic
│   └── index.ts            # Barrel exports
├── tools/                  # Agent tool infrastructure
│   ├── eval-service.ts     # Background Stockfish eval queue
│   ├── web-tools.ts        # Web search & fetch for agents
│   └── permissions.ts      # Session permission management
├── metrics/                # Maia-aligned scoring
│   ├── maia-scorer.ts      # Composite scorer + baseline
│   ├── move-accuracy.ts
│   ├── cpl-distribution.ts
│   ├── blunder-profile.ts
│   └── significance.ts     # Bootstrap CI, permutation tests
├── data/                   # Player data & caching (SQLite-backed)
│   ├── game-store.ts       # Lichess download + SQLite store
│   ├── splits.ts           # Deterministic train/test splits
│   └── eval-cache.ts       # Position eval cache (SQLite)
├── state/                  # Persistence (SQLite)
│   ├── types.ts
│   ├── forge-db.ts         # Central SQLite database (forge.db)
│   ├── forge-state.ts      # Session/agent CRUD (SQLite-backed)
│   ├── leaderboard-db.ts
│   └── migrate-files-to-sqlite.ts
├── oracle/                 # Multi-model consultation
│   ├── oracle.ts           # Claude → ChatGPT → Claude pipeline
│   ├── oracle-limiter.ts   # Rate limiting (burn-in for exploratory)
│   ├── surprise-tracker.ts # Oracle prediction accuracy tracking
│   ├── incremental-detector.ts # Pattern detection (tuning vs research)
│   └── clients.ts          # LLM API wrappers (askClaude, askChatGPT)
├── hypothesis/             # 3-hypothesis framework
│   └── hypothesis-manager.ts
├── knowledge/              # Topic-based knowledge base (SQLite-backed)
│   ├── index.ts            # Topics + notes CRUD, search, seeding
│   └── topics/             # Curated markdown seed data (8 topics)
└── log/                    # Experiment logging & trends
    ├── log-formatter.ts
    ├── trend-tracker.ts
    └── experiment-log.ts
```

## Data Storage

All persistent state is stored in **SQLite** (`forge.db`) with WAL mode for concurrent access:

- **Sessions & agents** — replaces the old `forge-state.json`
- **Player games & metadata** — replaces `data/games/*.json` files
- **Pre-computed evaluations** — Stockfish evals cached per position
- **Console logs** — dual-written to JSONL (streaming) + SQLite (querying)
- **Tool jobs** — eval queue, blocking jobs for agent orchestration
- **Permission requests** — agent permission request/approval flow
- **Papers & reviews** — scientific papers, peer reviews, citation graph (paper_references)
- **Knowledge** — topics (auto-seeded from markdown) and inter-agent notes

The leaderboard has its own SQLite database (`leaderboard.db`) to prevent agent tampering.

## Agent Architecture

Agents run in a two-level loop:

1. **Outer loop** (`agent-manager.ts`): Cycles sessions, makes autonomous decisions about what to research next, manages agent lifecycle and leaderboard
2. **Inner loop** (`agent-loop.ts`): Runs a single research session — hypothesis → code changes → eval → record results

Each session gets its own **git worktree** (sandbox). Worktrees persist across agent restarts — if an agent dies, its worktree stays intact for resumption. PIDs track agent processes only, not sessions.

All session branches are **always pushed** to GitHub after paper generation (paper.md + code changes). Positive-delta papers are submitted for peer review; negative-delta papers are marked abandoned.

After session completion, a **scientific paper** is auto-generated from session data. Papers with positive composite delta are submitted for peer review. The decision step considers: papers by other agents needing review, and the author's own papers needing revision (which triggers a full revision session).

**Leaderboard scoring:** 1× for continuous (H1/H2), 5× for groundbreaking (H3), 0.5× penalty for config-only sessions.

## Train/Test Methodology

- **Split**: 80% train / 20% test (deterministic, seed-based)
- **Profiles from train only**: Error profile, opening trie, style metrics
- **Evaluation on test only**: Move accuracy, CPL, blunder rates
- **Phase-balanced sampling**: 40% opening, 40% middlegame, 20% endgame
- **Statistical rigor**: Bootstrap 95% CIs, paired permutation tests (p < 0.05)
