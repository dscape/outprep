# outprep

Scout any chess player, study their openings and weaknesses, then practice against a bot that plays like them.

Enter a Lichess username or drop a PGN file, and outprep builds a profile of the player's repertoire, tendencies, and mistakes. Then it spawns a Stockfish-based bot tuned to mimic that player's style so you can practice before your next game.

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Enter a Lichess username and hit **Scout**.

Stockfish WASM files are copied to `public/` automatically via `postinstall`.

## How it works

1. **Scout** a player — fetches their recent games from the Lichess API
2. **Analyze** their openings, weaknesses, and error patterns
3. **Play** against a bot calibrated to their Elo, opening book, and mistake profile

The bot uses Boltzmann move selection over Stockfish MultiPV lines, with per-phase skill adjustment and complexity-aware depth scaling. It's not a random move generator — it tries to make the same kinds of mistakes your opponent would.

## Project structure

This is an npm workspaces monorepo:

```
src/                    Next.js app (frontend + API routes)
packages/
  engine/               Core bot logic (move selection, config, types)
  harness/              CLI to replay positions and measure bot accuracy
  tuner/                Autonomous parameter optimizer (uses Claude API)
  dashboard/            Vite + React app to visualize harness results
```

### `@outprep/engine`

Reusable TypeScript library. Boltzmann-weighted move selection, opening trie, error profiling, phase detection, complexity-based depth adjustment, and move style biases. All behavior is driven by a single `BotConfig` object.

### `@outprep/harness`

CLI tool that replays real player games and measures how closely the bot mimics the player. Outputs match rate, top-4 rate, CPL delta, and book coverage.

```bash
# Create a test dataset from a Lichess player
npm run harness:create -- --username DrNykterstein --games 20

# Run accuracy test
npm run harness:run -- --dataset datasets/DrNykterstein.json

# Compare two result files side by side
npm run harness:compare -- results/a.json results/b.json
```

### `@outprep/tuner`

Autonomous agent that sweeps engine parameters, measures accuracy with the harness, and sends results to Claude for analysis. Produces human-readable proposals with suggested config changes.

```bash
# Copy the env template and add your Anthropic API key
cp packages/tuner/.env.example packages/tuner/.env

# Run a full tuning cycle
npm run tuner -- start
```

The tuner follows a state machine: **gather** datasets, **sweep** parameters, **analyze** with Claude, generate a **proposal**, then wait for human review (`accept` / `reject`).

```bash
npm run tuner -- status      # Check current state
npm run tuner -- history     # View past proposals
npm run tuner -- accept      # Apply the latest proposal to DEFAULT_CONFIG
npm run tuner -- reject      # Archive and skip
```

### `@outprep/dashboard`

Drag-and-drop harness result JSON files to visualize accuracy trends, phase breakdowns, CPL analysis, and config diffs.

```bash
npm run dashboard
```

Opens at [http://localhost:5180](http://localhost:5180).

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the Next.js dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run harness:create` | Create a test dataset from Lichess |
| `npm run harness:run` | Run accuracy test |
| `npm run harness:compare` | Compare two result sets |
| `npm run tuner -- start` | Run a full tuning cycle |
| `npm run tuner -- status` | Check tuner state |
| `npm run dashboard` | Open the results dashboard |

## Tech stack

- [Next.js](https://nextjs.org) 16 + React 19 + Tailwind CSS 4
- [chess.js](https://github.com/jhlywa/chess.js) for move generation and validation
- [Stockfish](https://stockfishchess.org) 18 WASM for evaluation
- [react-chessboard](https://github.com/Clariity/react-chessboard) for board UI
- [Lichess API](https://lichess.org/api) for player data
- [Claude API](https://docs.anthropic.com) for tuner analysis

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Suggestions and bug reports are welcome on the [issue tracker](https://github.com/dscape/outprep/issues).

## Public domain

This project is released into the public domain. See [UNLICENSE](UNLICENSE) for details. Do whatever you want with it.

---

Made with love in Porto.
