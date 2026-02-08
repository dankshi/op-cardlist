# Architecture & Data Strategy

## Core Goal

**The best UX/UI experience is the primary goal.** All architectural decisions should prioritize:
1. Fast page loads (< 1s)
2. Fresh, accurate data
3. Rich features (price history, trends, alerts)
4. Reliability (no data loss, graceful degradation)

---

## Data Architecture

### Separation of Concerns

```
data/
├── cards.json          # Card data (static, rarely changes)
├── prices.json         # Current prices (updated daily)
└── price-history/      # Historical prices (append-only)
    ├── 2026-02-07.json
    ├── 2026-02-08.json
    └── ...
```

**Why separate files?**
- Card data changes rarely (new sets, corrections)
- Prices change daily
- Prevents card scraper from wiping price data
- Enables price history without database complexity

### Card Data (`cards.json`)

Static card information that rarely changes:
- Card ID, name, type, colors, rarity
- Effect text, traits, attributes
- Image URLs
- Set information

**Update frequency:** When new sets release or corrections needed

### Price Data (`prices.json`)

Current market prices, updated frequently:
```typescript
interface PriceData {
  lastUpdated: string;
  prices: {
    [cardId: string]: {
      marketPrice: number | null;
      lowPrice: number | null;
      highPrice: number | null;
      tcgplayerUrl: string;
      tcgplayerProductId: number;
      lastUpdated: string;
    };
  };
}
```

**Update frequency:** Daily via automated job

### Price History (`price-history/YYYY-MM-DD.json`)

Daily snapshots for trend analysis:
```typescript
interface DailyPriceSnapshot {
  date: string;
  prices: {
    [cardId: string]: number | null; // Just market price for efficiency
  };
}
```

**Retention:** Keep 90-365 days of history

---

## Automation Strategy

### GitHub Actions (Recommended)

```yaml
# .github/workflows/update-prices.yml
name: Update Prices
on:
  schedule:
    - cron: '0 6 * * *'  # Daily at 6 AM UTC
  workflow_dispatch:      # Manual trigger

jobs:
  update-prices:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run scrape:prices
      - run: npm run archive:prices  # Save to history
      - uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: "chore: update prices [skip ci]"
          file_pattern: "data/prices.json data/price-history/*.json"
```

### Alternative: Vercel Cron

For serverless environments, use Vercel's cron feature with an API route.

---

## Data Loading Strategy

### Build Time (SSG)

For set pages and card pages:
```typescript
// lib/cards.ts
import cardsData from '@/data/cards.json';
import pricesData from '@/data/prices.json';

export function getCardById(id: string): Card | null {
  const card = findCard(id);
  if (!card) return null;

  // Merge price data
  const price = pricesData.prices[id];
  return { ...card, price };
}
```

### Runtime (Optional Enhancement)

For real-time prices, add an API route:
```typescript
// app/api/prices/[cardId]/route.ts
export async function GET(req, { params }) {
  // Fetch fresh price from TCGPlayer
  // Cache for 1 hour
}
```

---

## Database Consideration

### When to Add a Database

Consider PostgreSQL/Supabase when you need:
- Real-time price updates (< 1 hour freshness)
- User accounts (watchlists, alerts)
- Complex queries (price comparisons, analytics)
- More than 365 days of history

### Recommended Stack (Future)

```
Supabase (PostgreSQL)
├── cards          # Static card data
├── prices         # Current prices
├── price_history  # Time-series data
└── users          # User preferences, watchlists
```

### For Now: Keep It Simple

JSON files are sufficient when:
- Daily price updates are acceptable
- No user accounts needed
- History < 1 year
- < 10,000 cards

Current card count: ~2,700 cards = JSON is fine

---

## Scraper Improvements

### Incremental Updates

Only update cards that need it:
```typescript
// Skip cards updated within 24 hours
if (card.price?.lastUpdated) {
  const lastUpdate = new Date(card.price.lastUpdated);
  const hoursSince = (Date.now() - lastUpdate.getTime()) / 3600000;
  if (hoursSince < 24) continue;
}
```

### Priority Ordering

Update high-value cards first:
```typescript
// Sort by existing price (high to low), then by rarity
cards.sort((a, b) => {
  const priceA = a.price?.marketPrice ?? 0;
  const priceB = b.price?.marketPrice ?? 0;
  if (priceB !== priceA) return priceB - priceA;
  return rarityOrder[a.rarity] - rarityOrder[b.rarity];
});
```

### Rate Limiting & Retry

```typescript
const RATE_LIMIT_MS = 250;
const MAX_RETRIES = 3;

async function fetchWithRetry(card: Card): Promise<CardPrice | null> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await searchTCGPlayer(card);
    } catch (error) {
      if (attempt < MAX_RETRIES - 1) {
        await sleep(RATE_LIMIT_MS * (attempt + 1));
      }
    }
  }
  return null;
}
```

---

## UX Features Enabled by This Architecture

### 1. Price History Charts
Show 30/90/365 day trends on card detail pages.

### 2. Price Alerts (Future)
"Notify me when price drops below $X"

### 3. Price Comparison
Compare prices across variants (base vs parallel vs SAR)

### 4. Market Insights
"Top gainers this week", "Price drops", "New listings"

### 5. Portfolio Tracking (Future)
Track collection value over time

---

## Migration Plan

### Phase 1: Separate Price Storage (Now)
1. Create `prices.json` separate from `cards.json`
2. Update scrapers to use new structure
3. Update card loading to merge data

### Phase 2: Add Price History
1. Create daily snapshot script
2. Add GitHub Action for automation
3. Build price chart component

### Phase 3: Enhanced Features
1. Add price comparison views
2. Implement trend indicators
3. Add "price changed" badges

### Phase 4: Database (When Needed)
1. Migrate to Supabase
2. Add user authentication
3. Implement watchlists and alerts

---

## File Structure After Migration

```
op-cardlist/
├── data/
│   ├── cards.json           # Card data only (no prices)
│   ├── prices.json          # Current prices
│   └── price-history/       # Daily snapshots
├── scripts/
│   ├── scrape.ts            # Card data scraper
│   ├── scrape-prices.ts     # Price scraper (writes to prices.json)
│   └── archive-prices.ts    # Save daily snapshot
├── .github/
│   └── workflows/
│       └── update-prices.yml
└── src/
    └── lib/
        └── cards.ts         # Merges cards + prices
```
