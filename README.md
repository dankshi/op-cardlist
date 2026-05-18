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

The card data is scraped from the official One Piece Card Game website using [Cheerio](https://cheerio.js.org/) for HTML parsing.

### How It Works

The scraper fetches card data from:
```
https://en.onepiece-cardgame.com/cardlist/?series={SERIES_ID}
```

For each card, it extracts:
| Field | Description | Example |
|-------|-------------|---------|
| `id` | Unique card identifier | `OP13-118` or `OP13-118_p1` |
| `baseId` | Base card ID (without variant) | `OP13-118` |
| `name` | Card name | `Monkey.D.Luffy` |
| `type` | Card type | `LEADER`, `CHARACTER`, `EVENT`, `STAGE` |
| `colors` | Card color(s) | `["Red"]`, `["Red", "Green"]` |
| `rarity` | Rarity | `L`, `SEC`, `SP`, `SR`, `R`, `UC`, `C` |
| `cost` | Play cost (null for leaders) | `6` |
| `power` | Power value | `7000` |
| `counter` | Counter value | `1000` or `null` |
| `life` | Life (leaders only) | `4` |
| `attribute` | Attack attribute | `Strike`, `Slash`, `Special`, `Wisdom`, `Ranged` |
| `traits` | Character traits | `["Straw Hat Crew", "Supernovas"]` |
| `effect` | Card effect text | `[On Play] Draw 2 cards...` |
| `trigger` | Trigger effect | `Draw 1 card` or `null` |
| `imageUrl` | Official image URL | `https://en.onepiece-cardgame.com/images/...` |
| `variant` | Parallel variant | `p1`, `p2`, `p3`, `p4` |
| `isParallel` | Is alternate art | `true` or `false` |
| `artStyle` | Art style category | `standard`, `alternate`, `wanted`, `manga` |

### Quick Start

```bash
# Scrape all sets
npm run scrape

# Scrape only OP-13
npm run scrape:op13

# Scrape a specific set by series ID
npx tsx scripts/scrape-bandai-cards.ts 569113
```

Output is UPSERTed into the Supabase `cards` + `card_sets` tables (incremental: existing cards keep their `set_id` if a "reprint collection" set re-lists them).

### Series IDs Reference

The canonical list lives in [scripts/scrape-bandai-cards.ts](scripts/scrape-bandai-cards.ts) `SETS`. Current English-released sets:

| Set | Series ID |
|-----|-----------|
| OP-01 through OP-13 | `5691XX` (e.g. OP-13 → `569113`) |
| OP-14 / OP-15 (combined with EB-04) | `569114` / `569115` |
| EB-01, 02, 03 | `5692XX` |
| PRB-01, 02 | `5693XX` |

**Finding a new series ID:**
1. Go to https://en.onepiece-cardgame.com/cardlist/
2. View page source and search for `<select id="series">` — every option has the seriesId as its `value` attribute
3. OP-XX sets follow the pattern `569100 + XX`; EB-XX is `569200 + XX`; PRB-XX is `569300 + XX`

### Adding New Sets

Edit `scripts/scrape-bandai-cards.ts` and add to the `SETS` object:

```typescript
const SETS: Record<string, { id: string; name: string }> = {
  '569114': { id: 'op-14', name: 'OP-14 Booster Pack - [SET NAME]' },
  // ... existing sets
};
```

Then run:
```bash
npm run scrape
```

### Special Art Detection (Wanted/Manga)

The scraper categorizes parallel cards into art styles:
- **standard** - Base card artwork
- **alternate** - Regular parallel/alternate art
- **wanted** - Wanted poster style art
- **manga** - Manga panel style art

Since art styles can't be auto-detected from the website, they're identified by card ID in `scripts/scrape-bandai-cards.ts`:

```typescript
// Known wanted poster cards
const WANTED_CARDS = new Set<string>([
  'OP01-016_p4',
  'OP03-112_p4',
  'OP05-067_p4',
  'OP13-118_p4',
  'OP13-119_p4',
]);

// Known manga art cards
const MANGA_CARDS = new Set<string>([
  // Add manga card IDs here
]);
```

**To add new special art cards:**
1. Find the card ID (e.g., `OP09-011_p3`)
2. Add it to `WANTED_CARDS` or `MANGA_CARDS` in `scripts/scrape-bandai-cards.ts`
3. Run `npm run scrape` to update

### Troubleshooting

| Issue | Solution |
|-------|----------|
| Missing cards | Check if the official site has them listed |
| Missing parallels | Parallels use `_p1`, `_p2` suffixes in their ID |
| Wrong art style | Add card ID to `WANTED_CARDS` or `MANGA_CARDS` |
| Fetch errors | Check internet connection, official site may be down |
| Rate limiting | Scraper has 500ms delay between sets |

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
│   └── scrape-bandai-cards.ts    # Card data scraper (Bandai → cards + card_sets tables)
├── data/
│   └── set-images.json           # Booster box images for set tiles
└── public/
```

## Local Stripe Setup (Webhooks)

Stripe webhooks are required for processing payments. For local development, use the Stripe CLI to forward webhook events to your dev server.

### 1. Install Stripe CLI

**Windows (scoop):**
```bash
scoop install stripe
```

**Or download manually** from https://docs.stripe.com/stripe-cli#install

### 2. Login

```bash
stripe login
```

This opens your browser to authorize the CLI with your Stripe account.

### 3. Forward webhooks to localhost

In a separate terminal, run:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhooks
```

It will output a webhook signing secret:
```
> Ready! Your webhook signing secret is whsec_abc123...
```

Add this to your `.env.local`:
```
STRIPE_WEBHOOK_SECRET=whsec_abc123...
```

### 4. Test a payment

With both `npm run dev` and `stripe listen` running, place a test order using Stripe's test card:

| Field | Value |
|-------|-------|
| Card number | `4242 4242 4242 4242` |
| Expiry | Any future date |
| CVC | Any 3 digits |
| ZIP | Any 5 digits |

You should see the webhook event forwarded in the `stripe listen` terminal.

### Production Webhooks

For production, create a webhook endpoint in the Stripe Dashboard:
1. Go to **Developers > Webhooks**
2. Add endpoint: `https://yourdomain.com/api/stripe/webhooks`
3. Select event: `checkout.session.completed`
4. Copy the signing secret to your production environment variables

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
