# Price Scraping Documentation

This document covers how price scraping works for the One Piece TCG card database, including the mapping between Bandai's card variants and TCGPlayer's product listings.

## Overview

Card data comes from two sources:
1. **Bandai Official Website** (`scripts/scrape.ts`) - Card data, images, and variant IDs
2. **TCGPlayer API** (`scripts/scrape-prices.ts`) - Market prices

The challenge is matching Bandai's variant naming (p1, p2, p3, p4) to TCGPlayer's art style naming (Parallel, Super Alternate Art, etc.).

---

## Card Data Sources & Image Handling

### Two Bandai Sites

Card data is scraped from two official Bandai sites:

| Site | URL | Sets | Notes |
|------|-----|------|-------|
| English | `en.onepiece-cardgame.com` | OP-01 to OP-13 | Main booster sets |
| Asia English | `asia-en.onepiece-cardgame.com` | EB-01 to EB-04, PRB-01, PRB-02 | Extra & Premium boosters |

### Japanese vs English Images

**Key Insight:** Japanese sets release earlier than English versions. We want to show cards as early as possible.

- **Asia site** has card data earlier (Japanese release)
- **English site** gets card data later (English release)
- **Image URLs** follow the same path pattern on both sites: `/images/cardlist/card/[CARD_ID].png`

### Image Source Strategy

```
1. For sets on English site (OP-xx): Always use English images
2. For sets on Asia site (EB-xx, PRB-xx):
   a. Check if English images exist: curl -I https://en.onepiece-cardgame.com/images/cardlist/card/[CARD_ID].png
   b. If 200: Set englishImages=true (use English images)
   c. If 404: Set englishImages=false (use Japanese/Asia images)
```

### Current Status (as of scraping)

| Set | Card Data Source | Image Source | English Available |
|-----|------------------|--------------|-------------------|
| OP-01 to OP-13 | English site | English | ✅ |
| EB-01 | Asia site | English | ✅ |
| EB-02 | Asia site | English | ✅ |
| EB-03 | Asia site | English | ✅ |
| OP14-EB04 | Asia site | **Japanese** | ❌ (not yet) |
| PRB-01 | Asia site | English | ✅ |

### Updating When English Becomes Available

When a new set's English version releases:

1. Check if English images exist:
   ```bash
   curl -I https://en.onepiece-cardgame.com/images/cardlist/card/[SET_ID]-001.png
   ```

2. If 200 response, update `scripts/scrape.ts`:
   ```typescript
   // Change from:
   '556204': { id: 'op14-eb04', name: 'OP14-EB04...', site: 'asia', englishImages: false },
   // To:
   '556204': { id: 'op14-eb04', name: 'OP14-EB04...', site: 'asia', englishImages: true },
   ```

3. Re-run the scraper:
   ```bash
   npm run scrape
   ```

### Adding New Sets

When a new set (e.g., EB-05) is announced:

1. Find the series ID on the Asia site (check network tab or page source)
2. Add to `SETS` in `scripts/scrape.ts`:
   ```typescript
   '556205': { id: 'eb-05', name: 'EB-05 Extra Booster - [Name]', site: 'asia', englishImages: false },
   ```
3. Run scraper: `npm run scrape`
4. Run price scraper: `npm run scrape:prices -- --set=eb-05`

---

## Bandai Variant System

Bandai assigns variant codes to parallel/alternate art cards via HTML element IDs:

| Variant | Description |
|---------|-------------|
| (none) | Base/standard card |
| `_p1` | First parallel variant |
| `_p2` | Second parallel variant |
| `_p3` | Third parallel variant |
| `_p4` | Fourth parallel variant |
| `_p5`, `_p6` | Additional variants (rare) |

Example: `OP13-118` (base), `OP13-118_p1`, `OP13-118_p2`, etc.

---

## TCGPlayer Art Style Naming

TCGPlayer uses descriptive names for different art variants:

| TCGPlayer Name | Description | Rarity/Value |
|----------------|-------------|--------------|
| (Standard) | Base card, no special name | Common |
| Parallel | Standard alternate art with foil/texture | Uncommon |
| Super Alternate Art | Premium alternate artwork | Rare |
| Red Super Alternate Art | Color-themed super alternate | Very Rare |
| Wanted Poster | Wanted poster style artwork | Ultra Rare |
| Manga | Manga panel style artwork | Varies |
| Box Topper / Treasure | Promotional variants | Varies |

---

## Variant → TCGPlayer Mapping

Based on OP-13 analysis (Luffy, Ace, Sabo chase cards):

| Bandai Variant | TCGPlayer Art Style | Example Price (OP13-119 Ace) |
|----------------|---------------------|------------------------------|
| (base) | Standard | $3.93 |
| `_p1` | Parallel | $47.32 |
| `_p2` | Super Alternate Art | $1,197.99 |
| `_p3` | Red Super Alternate Art | $4,420.37 |
| `_p4` | Wanted Poster | $688.48 |

### Code Implementation

In `scrape-prices.ts`:

```typescript
// Map our card variants to expected TCGPlayer art styles
function getExpectedArtStyle(card: Card): InternalArtStyle {
  if (!card.isParallel) {
    return 'standard';
  }

  // Use artStyle if available from card data
  if (card.artStyle === 'manga') return 'manga';
  if (card.artStyle === 'wanted') return 'wanted';

  // For numbered variants without artStyle, map based on TCGPlayer naming:
  // p1 = Parallel (alternate art)
  // p2 = Super Alternate Art
  // p3 = Red/Color Super Alternate Art
  // p4 = Wanted Poster
  const variant = card.variant;
  if (variant === 'p1') return 'alternate';
  if (variant === 'p2') return 'super';
  if (variant === 'p3') return 'red-super';
  if (variant === 'p4') return 'wanted';

  return 'alternate';
}
```

---

## TCGPlayer Search Strategy

### Problem
TCGPlayer's search doesn't match well with Bandai's set prefix format (e.g., "OP13-118").

### Solution
Search using **card name + number only** (without set prefix):

```typescript
// Extract card number from baseId (e.g., "OP13-118" -> "118")
const cardNum = card.baseId.match(/-(\d+)$/)?.[1] || '';

// Best search format: "Monkey.D.Luffy 118"
let searchQuery = `${card.name} ${cardNum}`;
```

### Why This Works
- TCGPlayer indexes cards by set name ("Carrying On His Will"), not set code ("OP13")
- Searching "Monkey.D.Luffy 118" returns all OP13-118 variants
- The `customAttributes.number` field contains the actual card ID for filtering

### Fallback Strategy
If no results found with name + number, try with full baseId:
```typescript
if (allResults.length === 0) {
  const altQuery = `${card.name} ${card.baseId}`;
  // ... retry search
}
```

---

## Art Style Detection from TCGPlayer

TCGPlayer product names contain art style keywords:

```typescript
function getArtStyleFromName(productName: string): InternalArtStyle {
  const lower = productName.toLowerCase();

  // Order matters - check most specific first
  if (lower.includes('red super alternate')) return 'red-super';
  if (lower.includes('super alternate') || lower.includes('super alt')) return 'super';
  if (lower.includes('wanted') || lower.includes('wanted poster')) return 'wanted';
  if (lower.includes('manga')) return 'manga';
  if (lower.includes('treasure') || lower.includes('box topper')) return 'treasure';
  if (lower.includes('alternate art') || lower.includes('parallel')) return 'alternate';

  return 'standard';
}
```

---

## Matching Algorithm

1. Search TCGPlayer for card name + number
2. Filter results to matching card ID (check `customAttributes.number`)
3. Determine expected art style from card variant
4. Find best matching TCGPlayer product:
   - Exact match on art style preferred
   - Fallback to similar styles if no exact match
   - Final fallback to any non-standard version for parallels

```typescript
// For parallel cards, try to match the specific art style
result = matchingCards.find((r) => getArtStyleFromName(r.productName) === expectedStyle);

// If no exact match, try similar styles
if (!result && expectedStyle === 'red-super') {
  result = matchingCards.find((r) =>
    ['red-super', 'super', 'alternate'].includes(getArtStyleFromName(r.productName))
  );
}
// ... additional fallbacks
```

---

## Running the Scraper

### Scrape a specific set
```bash
npm run scrape:prices -- --set=op-13
```

### Scrape a specific card (with debug output)
```bash
npx tsx scripts/scrape-prices.ts --set=op-13 --card=op13-118 --debug
```

### Scrape all sets
```bash
npm run scrape:prices
```

### Command Line Options
- `--set=op-13` - Filter to specific set
- `--card=op13-118` - Filter to cards matching ID
- `--limit=10` - Limit number of cards processed
- `--debug` - Show detailed search/matching output

---

## Known Issues & Edge Cases

### 1. Cards with Same Number in Different Sets
When searching "Monkey.D.Luffy 118", results may include cards from multiple sets (OP07-118, OP13-118, etc.). The scraper filters by checking the card's `baseId` against `customAttributes.number`.

### 2. Not All Cards Have TCGPlayer Listings
Commons and uncommons often don't have active listings. The scraper returns `--` for these.

### 3. Variant Mapping May Vary by Set
The p1→p4 mapping was derived from OP-13 chase cards. Older sets may have different patterns:
- Some sets may not have all 4 parallel types
- Manga/Wanted cards may appear at different variant numbers
- Always verify with debug mode when scraping new sets

### 4. Special Reprints
Cards reprinted in later sets (e.g., `OP11-058_p1` appearing in OP-13) need special handling. The scraper currently processes them but may match the wrong set's version.

---

## Price Data Structure

Stored in `data/cards.json`:

```typescript
interface CardPrice {
  marketPrice: number | null;
  lowPrice: number | null;
  midPrice: number | null;
  highPrice: number | null;
  lastUpdated: string;           // ISO date
  tcgplayerUrl: string;          // Direct product link
  tcgplayerProductId: number;    // For API lookups
}
```

---

## UI Display

Prices are displayed in:
1. **Card Grid** (`CardGrid.tsx`) - Shows market price on thumbnails
2. **Card Detail Modal** (`card/[cardId]/page.tsx`) - Full price section with TCGPlayer link

### Sort & Filter Options
- Sort by: Price High, Price Low, Name, Card #
- Filter: "Has Price" to show only priced cards

---

## Future Improvements

1. **Set-specific variant mappings** - Different sets may have different p1-p4 patterns
2. **Automatic art style detection** - Use image analysis to detect art type
3. **Price history tracking** - Store historical prices for trend analysis
4. **Batch price updates** - Update only cards without prices or with stale data
5. **Error recovery** - Retry failed lookups with alternative search strategies
