# Contributing to outprep

Thanks for your interest in contributing. This document covers how to get set up and how we work together.

## Getting started

```bash
git clone https://github.com/dscape/outprep.git
cd outprep
npm install
npm run dev
```

This installs all workspace dependencies and copies the Stockfish WASM files to `public/`. The app runs at [http://localhost:3000](http://localhost:3000).

## Project layout

```
src/                    Next.js app (pages, API routes, components)
packages/
  engine/               Core bot logic (pure TypeScript, no framework deps)
  harness/              CLI for accuracy testing against real games
  tuner/                Autonomous parameter optimizer (needs Claude API key)
  dashboard/            Vite + React results visualizer
```

The `engine` package is the foundation — it has no dependencies on Next.js or the UI. The `harness` and `tuner` build on top of it. The main app in `src/` ties everything together.

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

## Working with the tuner

The tuner requires an Anthropic API key:

```bash
cp packages/tuner/.env.example packages/tuner/.env
# Edit .env and add your key
```

Never commit `.env` files. The `.gitignore` already excludes them.

## Questions?

Open an issue. There are no dumb questions.
