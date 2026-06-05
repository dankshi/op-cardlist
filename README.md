# One Piece TCG Card List

A fast, SEO-optimized One Piece Trading Card Game database built with Next.js.

## Features

- 3,800+ cards across all booster sets (OP-01 through OP-16, plus EB / PRB)
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

## Scraping Card Data / Adding a Set

Card data is scraped from the official One Piece Card Game site (via [Cheerio](https://cheerio.js.org/))
and UPSERTed into the Supabase `cards` + `card_sets` tables; prices come from TCGPlayer. The full,
authoritative process — which scripts to run, in what order, and the Bandai-now / TCGPlayer-later
timing — is the runbook:

➡️ **[docs/adding-a-set.md](docs/adding-a-set.md)** (technical checklist)
&nbsp;·&nbsp; **[designs/adding-a-set.md](designs/adding-a-set.md)** (human-readable summary)

Quick orientation:

```bash
npx tsx scripts/scrape-bandai-cards.ts 569116 --dry-run   # preview a set (569100+NN for OP)
npx tsx scripts/scrape-bandai-cards.ts 569116             # → cards + card_sets (incremental, idempotent)
```

The canonical set list lives in [scripts/scrape-bandai-cards.ts](scripts/scrape-bandai-cards.ts) `SETS`;
the data model for cards/prices is described in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). (Card data
is **not** stored in a JSON file — it lives in Supabase. The legacy `isParallel` flag was replaced by a
non-null `variant`.)

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
