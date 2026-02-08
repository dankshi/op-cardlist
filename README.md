# One Piece TCG Card List

A fast, SEO-optimized One Piece Trading Card Game database built with Next.js.

## Features

- 2,000+ cards across all booster sets (OP-01 through OP-13)
- Includes all parallel/alternate art versions
- Instant client-side filtering (color, type, rarity, art style)
- Full-text search by name, effect, or trait
- Mobile-responsive dark mode UI
- SEO optimized with structured data

## Getting Started

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build
```

Open [http://localhost:3000](http://localhost:3000) to view the site.

## Scraping Card Data

The card data is scraped from the official One Piece Card Game website.

### Scrape All Sets (Including Parallel Arts)

```bash
npm run scrape
```

This scrapes all booster sets (OP-01 through OP-13) and includes:
- Base cards (e.g., `OP13-118`)
- Parallel art versions (e.g., `OP13-118_p1`, `OP13-118_p2`, etc.)
- All rarities: L, SEC, SP, SR, R, UC, C

### Scrape a Single Set

```bash
npm run scrape:op13    # Scrapes only OP-13
```

Or pass any series ID directly:

```bash
npx tsx scripts/scrape.ts 569113   # OP-13
npx tsx scripts/scrape.ts 569101   # OP-01
```

### Series IDs Reference

| Set | Series ID |
|-----|-----------|
| OP-01 | 569101 |
| OP-02 | 569102 |
| OP-03 | 569103 |
| OP-04 | 569104 |
| OP-05 | 569105 |
| OP-06 | 569106 |
| OP-07 | 569107 |
| OP-08 | 569108 |
| OP-09 | 569109 |
| OP-10 | 569110 |
| OP-11 | 569111 |
| OP-12 | 569112 |
| OP-13 | 569113 |

### Adding New Sets

When a new set releases, add its series ID to `scripts/scrape.ts`:

```typescript
const SETS: Record<string, { id: string; name: string }> = {
  '569114': { id: 'op-14', name: 'OP-14 Booster Pack - [SET NAME]' },
  // ... existing sets
};
```

Then run `npm run scrape` to fetch all cards.

### Adding Special Art Cards (Wanted/Manga)

The scraper detects special art styles (Wanted poster art, Manga art) using known card ID lists in `scripts/scrape.ts`:

```typescript
// Known wanted poster cards
const WANTED_CARDS = new Set<string>([
  'OP01-016_p4',
  'OP13-118_p4',
  'OP13-119_p4',
  // Add more card IDs here
]);

// Known manga art cards
const MANGA_CARDS = new Set<string>([
  // Add manga card IDs here
]);
```

After adding new IDs, re-run `npm run scrape` to update the data.

## Data Structure

Card data is stored in `data/cards.json`:

```json
{
  "sets": [
    {
      "id": "op-13",
      "name": "OP-13 Booster Pack - CARRYING ON HIS WILL",
      "seriesId": "569113",
      "cardCount": 175,
      "cards": [
        {
          "id": "OP13-118",
          "baseId": "OP13-118",
          "name": "Monkey.D.Luffy",
          "type": "CHARACTER",
          "colors": ["Green"],
          "rarity": "SEC",
          "cost": 6,
          "power": 7000,
          "isParallel": false,
          "artStyle": "standard",
          "imageUrl": "https://en.onepiece-cardgame.com/images/cardlist/card/OP13-118.png"
        },
        {
          "id": "OP13-118_p1",
          "baseId": "OP13-118",
          "name": "Monkey.D.Luffy",
          "variant": "p1",
          "isParallel": true,
          "artStyle": "alternate",
          "rarity": "SP"
        },
        {
          "id": "OP13-118_p4",
          "baseId": "OP13-118",
          "name": "Monkey.D.Luffy",
          "variant": "p4",
          "isParallel": true,
          "artStyle": "wanted",
          "rarity": "SP"
        }
      ]
    }
  ],
  "lastUpdated": "2026-02-08T..."
}
```

## Project Structure

```
op-cardlist/
├── src/
│   ├── app/
│   │   ├── page.tsx              # Homepage
│   │   ├── [setId]/page.tsx      # Set pages (/op-13)
│   │   └── card/[cardId]/page.tsx # Card pages (/card/op13-118)
│   ├── components/
│   │   └── CardGrid.tsx          # Card grid with filters
│   ├── lib/
│   │   └── cards.ts              # Data loading utilities
│   └── types/
│       └── card.ts               # TypeScript interfaces
├── scripts/
│   └── scrape.ts                 # Card data scraper
├── data/
│   └── cards.json                # Scraped card data
└── public/
```

## Deployment

Deploy to Vercel:

```bash
npx vercel
```

Or connect your GitHub repo to Vercel for automatic deployments.

## SEO

The site is optimized for search terms like "op-13 card list":

- Clean URLs: `/op-13`, `/card/op13-118`
- Static generation for all pages
- JSON-LD structured data
- Meta descriptions with card counts
- Mobile-first responsive design
