# Social Sharing Features - Implementation Plan

## Overview

The goal is to make sharing cards and prices as viral as possible. When someone finds a $10k card, they should be able to share it with one click and have it look amazing on Twitter, Discord, and WhatsApp.

---

## Top 5 Features (Ranked by Viral Impact)

### 1. Dynamic OG Images with Price Overlay (HIGHEST IMPACT)

**Why it's #1:** When someone shares a link on Twitter/Discord, the preview image IS the viral moment. If people see "$10,000" right in their feed without clicking, that's maximum impact.

**Implementation:**
- Create `/api/og/[cardId]` route using `@vercel/og` (Satori)
- Generate images dynamically with:
  - Card image (centered)
  - Price badge overlay (large, prominent)
  - Card name + set info
  - Site branding

**Example URL:**
```
https://opcardlist.com/card/OP13-001_p1
→ OG image shows: Card art + "$2,450 Market Price" badge
```

**Technical approach:**
```typescript
// src/app/api/og/[cardId]/route.tsx
import { ImageResponse } from '@vercel/og'

export async function GET(request: Request, { params }) {
  const card = await getCardById(params.cardId)

  return new ImageResponse(
    <div style={{ display: 'flex', ... }}>
      <img src={card.imageUrl} />
      <div className="price-badge">${card.price?.marketPrice}</div>
      <div className="card-name">{card.name}</div>
    </div>,
    { width: 1200, height: 630 }
  )
}
```

**Update card pages to use dynamic OG:**
```typescript
export async function generateMetadata({ params }) {
  return {
    openGraph: {
      images: [`/api/og/${params.cardId}`],
    }
  }
}
```

---

### 2. One-Click Share Buttons with Pre-Populated Text

**Why it's #2:** Reduces friction to zero. Pre-written viral text + link = more shares.

**Implementation:**
- Add share button row to card detail page
- Pre-populate with engaging text

**Share Targets:**
| Platform | Pre-populated Text |
|----------|-------------------|
| Twitter/X | `🔥 Check out this ${card.name} - currently at $${price}! ${url}` |
| Discord | Copy button with formatted message |
| WhatsApp | `Check out this card: ${card.name} ($${price}) ${url}` |
| Copy Link | Simple URL copy with toast confirmation |

**Component:**
```typescript
// src/components/ShareButtons.tsx
export function ShareButtons({ card }: { card: CardWithPrice }) {
  const url = `https://opcardlist.com/card/${card.id}`
  const text = `🔥 ${card.name} is at $${card.price?.marketPrice}!`

  return (
    <div className="flex gap-2">
      <TwitterShare text={text} url={url} />
      <CopyLink url={url} />
      <WhatsAppShare text={`${text} ${url}`} />
    </div>
  )
}
```

**Placement:**
- Card detail page (below price section)
- Card modal (bottom action bar)

---

### 3. Price Movement Shares ("This card just pumped!")

**Why it's #3:** Price movements are inherently viral. "Up 200% this week" drives FOMO and engagement.

**Implementation:**

**A. Price Change Badge on Cards:**
```typescript
// Show on cards with significant price movement
{priceChange > 20 && (
  <div className="badge-red">🔥 +{priceChange}% this week</div>
)}
{priceChange < -20 && (
  <div className="badge-blue">📉 {priceChange}% this week</div>
)}
```

**B. Dedicated "Hot Cards" / "Movers" Page:**
- `/hot` - Cards with biggest price increases
- `/drops` - Cards with biggest decreases
- Shareable with OG images showing the movement

**C. Share URL with price context:**
```
https://opcardlist.com/card/OP13-001?context=pump
→ OG image: "UP 150% THIS WEEK! $50 → $125"
```

**Data Source:** Already have `/data/price-history/` with daily snapshots - calculate 7-day and 30-day changes.

---

### 4. "My Collection Value" / Portfolio Showcase

**Why it's #4:** People LOVE flexing their collections. "My collection is worth $50k" is extremely shareable.

**Implementation:**

**A. Collection Builder (localStorage first, optional auth later):**
```typescript
// Store in localStorage
interface Collection {
  cards: { cardId: string; quantity: number }[]
  name: string
  createdAt: string
}
```

**B. Shareable Collection Page:**
- `/collection/[shareId]` - Public view of someone's collection
- Shows: Total value, top cards, card grid
- OG image: "My One Piece TCG Collection: $12,450"

**C. Share Flow:**
1. User builds collection locally
2. Click "Share" → generates unique URL (encode in URL or save to simple backend)
3. Link shows their collection with total value

**Viral Text:**
```
"My One Piece TCG collection is worth $12,450! 💰
Top card: Luffy (Gear 5) - $2,400
See the full collection: {url}"
```

---

### 5. Card Comparison / "Worth More Than" Shares

**Why it's #5:** Comparisons are inherently engaging. "This card costs more than a PS5!" or comparing two cards.

**Implementation:**

**A. Compare Two Cards:**
- `/compare/[cardId1]/[cardId2]`
- Side-by-side view with prices
- OG image: Both cards + prices

**B. "Worth More Than" Context:**
```typescript
const comparisons = [
  { threshold: 500, text: "a Nintendo Switch" },
  { threshold: 1000, text: "an iPhone" },
  { threshold: 2000, text: "a PS5 + games" },
  { threshold: 5000, text: "a used car" },
  { threshold: 10000, text: "a semester of college" },
]

// On card page: "This card is worth more than a PS5!"
```

**C. Share Text:**
```
"This One Piece card costs more than a PS5! 🤯
${card.name}: $${price}
${url}"
```

---

## Implementation Priority

| Priority | Feature | Effort | Impact |
|----------|---------|--------|--------|
| P0 | Dynamic OG Images | Medium | 🔥🔥🔥🔥🔥 |
| P0 | Share Buttons | Low | 🔥🔥🔥🔥 |
| P1 | Price Movement Badges | Medium | 🔥🔥🔥🔥 |
| P1 | Hot Cards Page | Medium | 🔥🔥🔥 |
| P2 | Collection Sharing | High | 🔥🔥🔥 |
| P2 | Card Comparison | Medium | 🔥🔥 |

---

## Technical Requirements

### Dependencies to Add:
```bash
npm install @vercel/og
```

### New Files:
```
src/app/api/og/[cardId]/route.tsx     # Dynamic OG image generation
src/components/ShareButtons.tsx        # Share button component
src/components/PriceChangeBadge.tsx   # Price movement indicator
src/app/hot/page.tsx                  # Hot movers page
src/lib/price-history.ts              # Price change calculations
```

### Data Updates:
- Calculate and cache 7-day/30-day price changes
- Add to daily price update workflow

---

## Quick Wins (Can Ship Today)

1. **Share Buttons** - Add Twitter/Copy buttons to card detail page
2. **Better OG Description** - Include price in og:description text
3. **Viral Meta Tags** - Add price to Twitter card text

---

## Mockup: Dynamic OG Image

```
┌────────────────────────────────────────────────────────────┐
│                                                            │
│  ┌──────────────┐                                          │
│  │              │     MONKEY.D.LUFFY                       │
│  │  [Card Art]  │     OP13-001 • Treasure Cup              │
│  │              │                                          │
│  │              │     ┌─────────────────────┐              │
│  │              │     │  $2,450             │              │
│  │              │     │  MARKET PRICE       │              │
│  └──────────────┘     └─────────────────────┘              │
│                                                            │
│                       opcardlist.com                       │
└────────────────────────────────────────────────────────────┘
```

Size: 1200x630 (Twitter/Facebook optimal)

---

## Success Metrics

- **Shares per card view** - Track share button clicks
- **Social referral traffic** - UTM parameters on shared links
- **OG image loads** - Track `/api/og/` requests
- **Viral coefficient** - New users from shared links

---

## Future Ideas (V2)

- **Price Alerts** - "Notify me when this card hits $X" → shareable when triggered
- **Deck Builder** - Share complete decks with total value
- **Wishlist** - "Cards I want" shareable page
- **Trade Calculator** - "Is this trade fair?" shareable comparison
- **Leaderboard** - "Top collectors this month" public ranking
