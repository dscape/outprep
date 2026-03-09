# Security

## Reporting a vulnerability

If you find a security issue, please report it by opening an [issue](https://github.com/dscape/outprep/issues). If the issue is sensitive (e.g., it involves exposed credentials or a way to compromise user data), mention that in the issue title and we'll coordinate privately.

## What to watch for

- **Database credentials**: The `DATABASE_URL` environment variable contains the Postgres connection string. In production this includes credentials for the hosted database (e.g., Neon). This file is gitignored and must never be committed.
- **Cron secret**: The `CRON_SECRET` environment variable authenticates Vercel cron job requests. Vercel sets it automatically; it should not be shared.
- **API keys**: The forge uses an Anthropic API key stored in `packages/forge/.env`. This file is gitignored and must never be committed.
- **Environment files**: All `.env` files are excluded from version control. Only `.env.example` templates are tracked.
- **Stockfish WASM**: The WASM files in `public/` are copied from `node_modules` at install time and gitignored. They are not sensitive but are large binaries that don't belong in the repo.

## Architecture notes

- The Next.js app fetches player data from the public Lichess API. No authentication is required or stored.
- FIDE player and game data is stored in PostgreSQL. The connection is authenticated via `DATABASE_URL`.
- Stockfish runs entirely client-side in a Web Worker. No positions or analysis are sent to external servers.
- The forge is the only component that calls an external API (Anthropic Claude) and it requires an explicit API key in a local `.env` file.
- Cron job routes verify the `CRON_SECRET` header before executing any pipeline operations.
