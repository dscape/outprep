# @outprep/fide-pipeline

Download, process, and upload FIDE player data from [This Week in Chess (TWIC)](https://theweekinchess.com/) PGN archives. Creates landing pages data for SEO and practice.

## Prerequisites

- Node.js 20+
- `unzip` command available (pre-installed on macOS/Linux)
- `BLOB_READ_WRITE_TOKEN` environment variable (for upload to Vercel Blob)

Get a Blob token from: **Vercel Dashboard → Storage → Blob → Tokens**

## Quick Start

```bash
# Smoke test — download 1 TWIC issue, parse, aggregate (no upload)
npm run fide-pipeline -- smoke --skip-upload

# Smoke test with Blob upload (uses fide-smoke/ prefix)
BLOB_READ_WRITE_TOKEN=vercel_blob_... npm run fide-pipeline -- smoke
```

## Full Pipeline

```bash
# Step 1: Download TWIC zip files (~200 issues = ~4 years of OTB games)
npm run fide-pipeline -- download --from 1433 --to 1633

# Step 2: Process PGNs into player profiles
npm run fide-pipeline -- process --min-games 3

# Step 3: Upload to Vercel Blob
BLOB_READ_WRITE_TOKEN=vercel_blob_... npm run fide-pipeline -- upload

# Or all three in one command:
BLOB_READ_WRITE_TOKEN=vercel_blob_... npm run fide-pipeline -- full --from 1433 --to 1633
```

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

Parse downloaded PGNs and aggregate player data.

| Flag | Default | Description |
|------|---------|-------------|
| `--min-games <n>` | 3 | Minimum games for a player to be included |

### `upload`

Upload processed data to Vercel Blob.

| Flag | Default | Description |
|------|---------|-------------|
| `--prefix <p>` | fide | Blob path prefix |

### `full`

Download, process, and upload in one command.

| Flag | Default | Description |
|------|---------|-------------|
| `--from <n>` | required | First TWIC issue number |
| `--to <n>` | required | Last TWIC issue number |
| `--min-games <n>` | 3 | Minimum games per player |
| `--prefix <p>` | fide | Blob path prefix |
| `--delay <ms>` | 500 | Delay between downloads |

## Data Format

### PlayerIndex (`fide/index.json`)

Master list of all players. Used by the sitemap and listing pages.

```typescript
interface PlayerIndex {
  generatedAt: string;    // ISO timestamp
  totalPlayers: number;
  players: Array<{
    slug: string;         // Canonical URL slug (e.g., "f-caruana-2020009")
    name: string;         // Display name (e.g., "Caruana,F")
    fideId: string;       // FIDE ID (e.g., "2020009")
    aliases: string[];    // Alternative slugs that 301 redirect to canonical
    fideRating: number;
    title: string | null; // "GM", "IM", "FM", etc.
    gameCount: number;
  }>;
}
```

### FIDEPlayer (`fide/players/{slug}.json`)

Full profile for a single player. Only players with a FIDE ID are included.

```typescript
interface FIDEPlayer {
  name: string;
  slug: string;           // Canonical: firstname-lastname-fideId
  fideId: string;         // FIDE ID (used for dedup + uniqueness)
  aliases: string[];      // Alternative slugs → 301 redirect to canonical
  fideRating: number;
  title: string | null;
  gameCount: number;
  recentEvents: string[];
  lastSeen: string;       // YYYY.MM.DD
  openings: {
    white: OpeningStats[];
    black: OpeningStats[];
  };
  winRate: number;        // 0-100
  drawRate: number;
  lossRate: number;
}
```

### Aliases (`fide/aliases.json`)

Map from alias slug → canonical slug for 301 redirects.

```json
{
  "caruana-f-2020009": "f-caruana-2020009",
  "caruana-f": "f-caruana-2020009",
  "carlsen-m-1503014": "m-carlsen-1503014",
  "carlsen-m": "m-carlsen-1503014"
}
```

### URL Slug Design

**Canonical slug** = `{firstname}-{lastname}-{fideId}` (matches natural search queries):
- `"Caruana,F"` → `/player/f-caruana-2020009`
- `"Carlsen,M"` → `/player/m-carlsen-1503014`

**Aliases** (301 redirect to canonical):
- `caruana-f-2020009` → lastname-first order + FIDE ID
- `caruana-f` → short form without FIDE ID

Players without a FIDE ID are not indexed (no landing page generated).

### Player Games (`fide/games/{slug}.json`)

Array of raw PGN strings for practice mode.

## Blob Structure

```
fide/
├── index.json                     # ~2 MB  (all players)
├── aliases.json                   # ~200 KB (alias → canonical map)
├── players/
│   ├── m-carlsen-1503014.json     # ~10 KB (profile)
│   ├── hi-nakamura-2016192.json
│   └── ...
└── games/
    ├── m-carlsen-1503014.json     # ~100 KB (raw PGNs)
    ├── hi-nakamura-2016192.json
    └── ...
```

## Adding New TWIC Issues

To add the latest weekly issue:

```bash
# Download just the new issue
npm run fide-pipeline -- download --from 1634 --to 1634

# Re-process all downloaded data
npm run fide-pipeline -- process --min-games 3

# Re-upload
BLOB_READ_WRITE_TOKEN=vercel_blob_... npm run fide-pipeline -- upload
```

Or set up the GitHub Action (see `.github/workflows/twic-update.yml`) for automatic weekly updates.

## Troubleshooting

### "BLOB_READ_WRITE_TOKEN not set"

Set the env var before running upload commands. Get a token from Vercel Dashboard → Storage → Blob.

### "No .pgn file found in zip archive"

Some TWIC issues may have non-standard zip structure. The download script skips failed issues and continues.

### Slow downloads

TWIC has rate limiting. The default 500ms delay between downloads keeps us under their limits. For bulk downloads, this means ~200 issues takes ~2 minutes just for delays.

### Large data directory

Downloaded PGN files are cached in `packages/fide-pipeline/data/`. Delete the `data/` directory to free disk space after uploading.
