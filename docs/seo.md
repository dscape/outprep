# SEO Architecture

## Overview

outprep uses SEO landing pages to attract chess players searching for preparation tools. Each FIDE-rated player with OTB games gets a landing page at `/player/{slug}`, and each recorded game gets a page at `/game/{slug}`.

## Data Pipeline

1. TWIC (This Week in Chess) zip files are downloaded and parsed
2. Player and game data (names, ratings, openings, events) is extracted
3. Processed data is seeded to PostgreSQL via `packages/fide-pipeline/src/upload-pg.ts` (CLI command: `seed-db`)
4. FIDE official ratings are updated monthly via `/api/cron/fide-ratings` (automated on Vercel)
5. TWIC updates run weekly via `/api/cron/twic-update` (automated on Vercel)
6. CLI usage: `npm run fide-pipeline -- --help`

## Indexed Pages

### Player Pages (`/player/[slug]`)

- **Route:** `/player/[slug]` (e.g., `/player/carlsen-magnus-2020009`)
- **Rendering:** ISR (Incremental Static Regeneration) with 7-day revalidation
- **All players are generated on-demand** via ISR (`dynamicParams: true`, `generateStaticParams` returns `[]`). This avoids pre-rendering 80K+ pages at build time.
- **Alias handling:** Legacy/alternative slugs 301-redirect to canonical slugs via `player_aliases` table

**Page content:**
- Name, FIDE title badge, rating (Standard/Rapid/Blitz)
- Win/draw/loss percentages
- Recent tournament events
- Opening repertoire (as white and black)
- Notable and recent games with links to game pages
- "Practice Against [Name]" CTA button

**Metadata:**
- Dynamic `<title>`: `{Name} ({Title} {Rating}) - Chess Preparation | outprep`
- Dynamic meta description with ratings, federation, game count
- Canonical URL: `https://outprep.xyz/player/{slug}`
- Open Graph tags (type: `profile`)
- Twitter card: `summary_large_image`
- Dynamic OG image generated via `opengraph-image.tsx` (player name, ratings, stats)

**JSON-LD structured data:**
- `Person` schema (name, description, nationality, FIDE profile link via `sameAs`)
- `WebApplication` schema (outprep app metadata)
- `BreadcrumbList` (Home > {Player Name})

### Game Pages (`/game/[...slug]`)

- **Route:** `/game/[...slug]` (e.g., `/game/carlsen-magnus-vs-caruana-fabiano-2023-01-15-tata-steel`)
- **Rendering:** ISR with 7-day revalidation
- **All games generated on-demand** (same pattern as players)
- **Alias handling:** Legacy slugs 301-redirect via `game_aliases` table

**Page content:**
- Players with title badges, elos, and federation flags
- Game result with visual indicator
- Event, date, site, round
- Opening (ECO code + name + variation)
- Interactive game replay (when PGN available)
- CTAs to practice against either player

**Metadata:**
- Dynamic `<title>`: `{White} vs {Black} - {Event} ({Year}) | {ECO} {Opening}`
- Dynamic meta description with player names, ratings, event, result, opening
- Canonical URL: `https://outprep.xyz/game/{slug}`
- Open Graph tags (type: `article`)
- Twitter card: `summary_large_image`
- Dynamic OG image generated via `opengraph-image.tsx` (players, result, event, opening)

**JSON-LD structured data:**
- `SportsEvent` schema (players as competitors, event details, opening)
- `BreadcrumbList` (Home > {White Player} > vs {Black Player})

### Homepage (`/`)

**Metadata:**
- Title: `outprep - Practice Against Any Chess Player`
- Template: `%s | outprep`
- Canonical: `https://outprep.xyz`
- Open Graph + Twitter card: `summary_large_image`
- Dynamic OG image (`opengraph-image.tsx`)

**JSON-LD:**
- `WebApplication` schema (free pricing)
- `WebSite` schema with `SearchAction` (enables Google Sitelinks Search Box)
- `FAQPage` schema

**Content sections:**
- Hero with search + PGN upload
- How It Works (Scout → Study → Practice)
- Featured Players grid (top 12 by rating, links to player pages)
- FAQ (4 questions with collapsible answers)

### Scout Pages (`/scout/[username]`)

- Indexed with canonical URL: `https://outprep.xyz/scout/{username}`
- Dynamic title and OG metadata
- Not in sitemap (user-initiated, infinite URL space)

### Non-Indexed Pages

- `/play/[username]` — `robots: { index: false }` (session-based practice)
- `/analysis/[gameId]` — `robots: { index: false }` (session-based analysis)

## SEO Infrastructure

### Sitemap (`/sitemap.xml`)

- Generated dynamically from PostgreSQL using paginated queries
- Supports sitemap splitting (45K URLs per file, under the 50K limit)
- Three sitemap types:
  - Sitemap 0: Static pages (homepage)
  - Sitemaps 1..P: Player pages (via `getPlayerSlugsForSitemap`)
  - Sitemaps P+1..end: Game pages (via `getGameSlugsForSitemap`)
- Priority scaled by FIDE rating:
  - Homepage: 1.0
  - Players 2500+: 0.9, 2000+: 0.7, others: 0.5
  - Games with avgElo 2500+: 0.7, others: 0.5
- Change frequency: weekly for players, monthly for games

### Robots (`/robots.txt`)

- Allows all crawlers
- References sitemap URL: `https://outprep.xyz/sitemap.xml`

### OG Images

Dynamic OG images (1200x630) are generated using Next.js `ImageResponse` API:
- **Player images:** Name, title badge, federation, ratings (color-coded), win/draw/loss bar, game count
- **Game images:** Player names with titles, elos, result, event/date, opening
- **Homepage image:** Brand logo, tagline, chess knight icon
- **Apple touch icon:** 180x180 generated via `apple-icon.tsx`

All images use the Geist font (`src/assets/fonts/Geist-Bold.ttf` and `Geist-Regular.ttf`).

### Internal Linking

- Homepage → Player pages (via featured players grid)
- Player pages → Game pages (via recent/notable games lists)
- Game pages → Player pages (via player names and practice CTAs)
- Game pages have visible breadcrumb navigation (Home > Player > Game)
- Scout pages link to player pages and game pages

## Keyword Strategy

### Primary Clusters

1. **Player preparation** (highest value):
   - "prepare against {player name}"
   - "{player name} chess openings"
   - "{player name} chess games"
   - "{player name} FIDE rating"
   - Target: `/player/{slug}` pages

2. **Chess tools:**
   - "chess preparation tool"
   - "practice against chess AI"
   - "chess opening preparation"
   - "chess scouting report"
   - Target: Homepage and `/scout/{username}` pages

3. **Game archive:**
   - "{white} vs {black} chess game"
   - "{event} chess {year}"
   - "{ECO code} opening games"
   - Target: `/game/{slug}` pages

4. **Long-tail educational:**
   - "how to prepare for chess tournament"
   - "chess opponent preparation strategy"
   - Target: Homepage FAQ section

## Testing SEO

```bash
# Start dev server
npm run dev

# Check a player page (view source for meta tags)
open http://localhost:3000/player/carlsen-magnus-2020009

# Check OG image renders
open http://localhost:3000/player/carlsen-magnus-2020009/opengraph-image

# Check a game page
open http://localhost:3000/game/carlsen-magnus-vs-caruana-fabiano-2023-01-15-tata-steel

# Check sitemap
open http://localhost:3000/sitemap.xml

# Check robots.txt
open http://localhost:3000/robots.txt

# Validate JSON-LD: paste page source into Google Rich Results Test
# Validate social previews: Twitter Card Validator / Facebook Debugger
```

## Adding New Landing Page Types

To add a new type of SEO page (e.g., tournament pages, opening pages):

1. Create data processing in the pipeline
2. Add tables and upload script in `packages/fide-pipeline/src/upload-pg.ts (CLI command: `seed`)`
3. Create a new route at `src/app/{type}/[slug]/page.tsx`
4. Add `generateMetadata()` and `generateStaticParams()` (return `[]` for ISR)
5. Create `opengraph-image.tsx` for dynamic OG images
6. Add entries to `src/app/sitemap.ts`
7. Add JSON-LD structured data (choose appropriate schema.org type)
8. Add breadcrumb JSON-LD
