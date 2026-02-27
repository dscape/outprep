# @outprep/fide-pipeline

Download, process, and upload FIDE player data from [This Week in Chess (TWIC)](https://theweekinchess.com/) PGN archives. Enriches players with official FIDE names, ratings, and federation data.

## Prerequisites

- Node.js 20+
- `unzip` command available (pre-installed on macOS/Linux)

## Setup

### 1. Environment variables

Copy the example env file from the project root and fill in your values:

```bash
cp .env.example .env
```

The only variable needed is `BLOB_READ_WRITE_TOKEN` (for uploading to Vercel Blob):

| Variable | Required for | How to get it |
|----------|-------------|---------------|
| `BLOB_READ_WRITE_TOKEN` | `upload`, `full`, `smoke` (without `--skip-upload`) | [Vercel Dashboard](https://vercel.com/dashboard) → Storage → Blob → Tokens |

> **Local development doesn't need a token.** The Next.js app falls back to reading
> local files from `packages/fide-pipeline/data/processed/` when no token is set.

### 2. Create a Blob store (first time only)

1. Go to [vercel.com/dashboard](https://vercel.com/dashboard)
2. Select your project → **Storage** tab → **Create Database** → **Blob**
3. Name it (e.g. `outprep-blob`) and click **Create**
4. Go to the new store → **Tokens** tab → **Create Token**
5. Copy the token (starts with `vercel_blob_...`) into your `.env` file

### 3. FIDE rating list (for name + rating enrichment)

Download the official FIDE rating list from [ratings.fide.com](https://ratings.fide.com/download_lists.phtml):

1. Download the combined TXT zip (https://ratings.fide.com/download/players_list.zip) — a single file containing all ratings (Standard, Rapid, Blitz) per player
2. Place it at `packages/fide-pipeline/data/ratings/players_list.zip`

The zip contains one file (`players_list_foa.txt`) in fixed-width format with all three rating types per player row. The pipeline unzips to `/tmp` at runtime — the raw `.txt` file is never stored in the repo.

> **Without the FIDE zip**, the pipeline still works but uses abbreviated TWIC names
> (e.g. "Caruana,F" instead of "Caruana, Fabiano") and won't have official ratings.

## Quick Start

```bash
# Smoke test — download 1 TWIC issue, enrich with FIDE data (no upload)
npm run fide-pipeline -- smoke --skip-upload

# Smoke test with Blob upload (uses fide-smoke/ prefix)
npm run fide-pipeline -- smoke
```

## Full Pipeline

```bash
# Step 1: Download TWIC zip files (~200 issues = ~4 years of OTB games)
npm run fide-pipeline -- download --from 1433 --to 1633

# Step 2: Process PGNs + enrich with FIDE data
npm run fide-pipeline -- process --min-games 3

# Step 3: Upload to Vercel Blob
npm run fide-pipeline -- upload

# Or all three in one command:
npm run fide-pipeline -- full --from 1433 --to 1633
```

### Interrupting and resuming uploads

Uploads support **retry** and **resume**:

- **Rate limiting**: If Vercel Blob returns `BlobServiceRateLimited`, the upload retries automatically with backoff (up to 5 retries per file).
- **Resume**: A state file (`data/processed/upload-state.json`) tracks progress. If you interrupt with Ctrl+C, re-run the same upload command to pick up where you left off.
- **Fresh start**: Use `--fresh` to ignore the resume state and re-upload everything.

## FIDE Enrichment

The pipeline enriches TWIC data with the official FIDE rating list:

| Before (TWIC only) | After (enriched) |
|---|---|
| Name: `Caruana,F` | Name: `Caruana, Fabiano` |
| Slug: `f-caruana-2020009` | Slug: `fabiano-caruana-2020009` |
| Rating: 2786 (from game) | Standard: 2795, Rapid: 2727, Blitz: 2769 |
| No federation | Federation: USA |

Old slugs (`f-caruana-2020009`) become aliases that 301-redirect to the canonical URL.

## CLI Reference

### `smoke`

End-to-end test with a single TWIC issue.

| Flag | Default | Description |
|------|---------|-------------|
| `--issue <n>` | 1633 | TWIC issue to test with |
| `--skip-upload` | false | Skip Vercel Blob upload |

### `download`

Download TWIC zip files and extract PGN text.

| Flag | Default | Description |
|------|---------|-------------|
| `--from <n>` | required | First TWIC issue number |
| `--to <n>` | required | Last TWIC issue number |
| `--delay <ms>` | 500 | Delay between downloads (be polite to TWIC servers) |

### `process`

Parse downloaded PGNs, aggregate player data, and enrich with FIDE ratings.

| Flag | Default | Description |
|------|---------|-------------|
| `--min-games <n>` | 3 | Minimum games for a player to be included |

### `upload`

Upload processed data to Vercel Blob. Supports retry and resume.

| Flag | Default | Description |
|------|---------|-------------|
| `--prefix <p>` | fide | Blob path prefix |
| `--fresh` | false | Ignore resume state, re-upload everything |

### `full`

Download, process, and upload in one command.

| Flag | Default | Description |
|------|---------|-------------|
| `--from <n>` | required | First TWIC issue number |
| `--to <n>` | required | Last TWIC issue number |
| `--min-games <n>` | 3 | Minimum games per player |
| `--prefix <p>` | fide | Blob path prefix |
| `--delay <ms>` | 500 | Delay between downloads |
| `--fresh` | false | Ignore upload resume state |

## Data Format

### PlayerIndex (`fide/index.json`)

Master list of all players. Used by the sitemap and listing pages.

```typescript
interface PlayerIndex {
  generatedAt: string;
  totalPlayers: number;
  players: Array<{
    slug: string;           // "fabiano-caruana-2020009"
    name: string;           // "Caruana, Fabiano"
    fideId: string;         // "2020009"
    aliases: string[];      // Alternative slugs → 301 redirect
    fideRating: number;
    title: string | null;   // "GM", "IM", "FM", etc.
    gameCount: number;
    federation?: string;    // "USA"
    standardRating?: number;
    rapidRating?: number;
    blitzRating?: number;
  }>;
}
```

### FIDEPlayer (`fide/players/{slug}.json`)

Full profile for a single player. Only players with a FIDE ID are included.

```typescript
interface FIDEPlayer {
  name: string;             // "Caruana, Fabiano" (FIDE full name)
  slug: string;             // "fabiano-caruana-2020009"
  fideId: string;
  aliases: string[];
  fideRating: number;       // Most recent Elo from TWIC games
  title: string | null;
  gameCount: number;
  recentEvents: string[];
  lastSeen: string;         // YYYY.MM.DD
  openings: {
    white: OpeningStats[];
    black: OpeningStats[];
  };
  winRate: number;          // 0-100
  drawRate: number;
  lossRate: number;
  // Official FIDE ratings (from rating list enrichment)
  federation?: string;      // "USA", "NOR", etc.
  birthYear?: number;
  standardRating?: number;  // Official FIDE Standard
  rapidRating?: number;     // Official FIDE Rapid
  blitzRating?: number;     // Official FIDE Blitz
}
```

### Aliases (`fide/aliases.json`)

Map from alias slug → canonical slug for 301 redirects.

```json
{
  "f-caruana-2020009": "fabiano-caruana-2020009",
  "caruana-fabiano-2020009": "fabiano-caruana-2020009",
  "caruana-f": "fabiano-caruana-2020009"
}
```

### URL Slug Design

**Canonical slug** = `{firstname}-{lastname}-{fideId}`:
- `"Caruana, Fabiano"` → `/player/fabiano-caruana-2020009`
- `"Carlsen, Magnus"` → `/player/magnus-carlsen-1503014`

**Aliases** (301 redirect to canonical):
- `f-caruana-2020009` → old TWIC abbreviated slug
- `caruana-fabiano-2020009` → lastname-first order
- `caruana-f` → short form without FIDE ID

### Player Games (`fide/games/{slug}.json`)

Array of raw PGN strings for practice mode. Stored as individual per-player files on disk (not a single monolithic file) to keep memory usage low.

## Blob Structure

```
fide/
├── index.json                          # ~2 MB  (all players)
├── aliases.json                        # ~200 KB (alias → canonical map)
├── players/
│   ├── magnus-carlsen-1503014.json     # ~10 KB (profile)
│   ├── hikaru-nakamura-2016192.json
│   └── ...
└── games/
    ├── magnus-carlsen-1503014.json     # ~100 KB (raw PGNs)
    ├── hikaru-nakamura-2016192.json
    └── ...
```

## Adding New TWIC Issues

To add the latest weekly issue:

```bash
# Download just the new issue
npm run fide-pipeline -- download --from 1634 --to 1634

# Re-process all downloaded data (includes FIDE enrichment)
npm run fide-pipeline -- process --min-games 3

# Re-upload
npm run fide-pipeline -- upload
```

## Troubleshooting

### "BLOB_READ_WRITE_TOKEN not set"

Make sure you have a `.env` file in the project root with your token. See [Setup](#setup) above.

### "No .pgn file found in zip archive"

Some TWIC issues may have non-standard zip structure. The download script skips failed issues and continues.

### Rate limiting during upload

The upload automatically retries with backoff when Vercel Blob returns `BlobServiceRateLimited`. If it persists, the upload state is saved — just re-run the same command to resume.

### "Zip not found" for FIDE enrichment

If you see `[fide-enrichment] Zip not found`, download the FIDE rating list zip and place it at `data/ratings/players_list.zip`. The pipeline still works without it, just with abbreviated names.

### Large data directory

Downloaded PGN files are cached in `packages/fide-pipeline/data/`. Delete the `data/` directory to free disk space after uploading.
