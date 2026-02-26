# Security

## Reporting a vulnerability

If you find a security issue, please report it by opening an [issue](https://github.com/dscape/outprep/issues). If the issue is sensitive (e.g., it involves exposed credentials or a way to compromise user data), mention that in the issue title and we'll coordinate privately.

## What to watch for

- **API keys**: The tuner uses an Anthropic API key stored in `packages/tuner/.env`. This file is gitignored and must never be committed.
- **Environment files**: All `.env` files are excluded from version control. Only `.env.example` templates are tracked.
- **Stockfish WASM**: The WASM files in `public/` are copied from `node_modules` at install time and gitignored. They are not sensitive but are large binaries that don't belong in the repo.

## Architecture notes

- The Next.js app fetches player data from the public Lichess API. No authentication is required or stored.
- Stockfish runs entirely client-side in a Web Worker. No positions or analysis are sent to external servers.
- The tuner is the only component that calls an external API (Anthropic Claude) and it requires an explicit API key in a local `.env` file.
