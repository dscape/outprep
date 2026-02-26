# SEO Architecture

## Overview

outprep uses SEO landing pages to attract chess players searching for preparation tools. Each FIDE-rated player with OTB games gets a landing page at `/player/{slug}`.

## How It Works

### Data Pipeline

1. TWIC (This Week in Chess) zip files are downloaded and parsed
2. Player data (names, ratings, openings, events) is extracted
3. Processed data is uploaded to Vercel Blob storage
4. See `packages/fide-pipeline/README.md` for CLI usage

### Landing Pages

- **Route:** `/player/[slug]` (e.g., `/player/carlsen-magnus`)
- **Rendering:** ISR (Incremental Static Regeneration) with 7-day revalidation
- **Top 500 players** are pre-rendered at build time
- **All other players** render on first request, then cached at edge

### Page Content

Each player page includes:
- Name, FIDE title badge, rating
- Win/draw/loss percentages
- Recent tournament events
- Opening repertoire (as white and black)
- "Practice Against [Name]" CTA button
- JSON-LD structured data

### Practice Flow

When a user clicks "Practice Against [Name]":
1. Client fetches raw PGN games from `/api/fide-games/{slug}`
2. Games are parsed using chess.js (client-side)
3. OTB profile is built and stored in sessionStorage
4. User is redirected to `/scout/{name}?source=pgn`
5. Existing PGN mode handles openings, weaknesses, and bot play

## SEO Infrastructure

### Sitemap (`/sitemap.xml`)

- Generated dynamically from the Vercel Blob player index
- Supports sitemap splitting (40K URLs per file) for large player sets
- Includes all player pages + static pages
- Priority scaled by FIDE rating (2500+ = 0.9, 2000+ = 0.7, others = 0.5)

### Robots (`/robots.txt`)

- Allows all crawlers
- References sitemap URL

### Metadata

Every page has:
- Dynamic `<title>` using Next.js template: `%s | outprep`
- Meta description
- Open Graph tags (og:title, og:description, og:type, og:url)
- Twitter card tags
- Canonical URL

### Structured Data (JSON-LD)

Player pages include:
- `Person` schema (name, description, knowsAbout: Chess)
- `WebApplication` schema (outprep app metadata)

## Testing SEO Locally

```bash
# Start dev server
npm run dev

# Check a player page
open http://localhost:3000/player/carlsen-magnus

# View page source for meta tags
# Look for: <title>, <meta name="description">, og:*, JSON-LD script

# Check sitemap
open http://localhost:3000/sitemap.xml

# Check robots.txt
open http://localhost:3000/robots.txt
```

## Adding New Landing Page Types

To add a new type of SEO page (e.g., tournament pages, opening pages):

1. Create data processing in the pipeline
2. Upload structured data to Vercel Blob
3. Create a new route at `src/app/{type}/[slug]/page.tsx`
4. Add `generateMetadata()` and `generateStaticParams()`
5. Add entries to `src/app/sitemap.ts`
