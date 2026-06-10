# Slab Ingestion — Design Summary

> Human-readable version for sharing with stakeholders, partners, or pasting into Google Docs. Decision-and-rationale only; the technical companion (architecture, file references) lives at [docs/slab-ingestion.md](../docs/slab-ingestion.md). This is the "how do we actually pull graded sales, for every card, every day, without getting blocked" plan that sits underneath the [slab-pricing](slab-pricing.md) source-of-truth effort.

---

## The thesis: win the niche on speed, don't fight generalists on scale

The competitive idea is "be faster at registering sales than the third-party-reliant competitors." That's a real edge — **if scoped correctly.**

The trap is trying to out-scrape Card Ladder / Market Movers across *all* collectibles. They have proxy fleets and years of scale; you won't beat them at breadth, and aggressive broad scraping is exactly what gets you IP-banned.

The winnable version: **One Piece is a small universe** — a few hundred graded-worthy chase variants, not millions of SKUs. We can poll *those* every few hours and surface a sale within hours, while generalists run daily batches spread thin across everything. On One Piece specifically, that makes us the freshest — which *is* the "source of truth for One Piece" position. So: freshest on a focused high-value set, not real-time on everything. Real-time-everything is the over-reach.

---

## What we actually scrape (and why it's tractable)

Three decisions keep "scrape every card, every day" from being a monster:

1. **Only the graded-worthy cards.** Commons don't get slabbed. We target the chase variants (high market price / has grading population) — a few hundred to ~1,000, not the full ~3,700-card catalog.
2. **One search per card variant, not per grade.** A single eBay sold-search returns all grades for a card; we sort them into PSA 10 / BGS 9.5 / etc. afterward. So it's roughly one request per card.
3. **Only pull what's new.** Sorted newest-first and de-duplicated, each daily check ingests just the handful of genuinely new sales since last time — not a full re-scrape.

Layer on **tiered frequency** (a $2,000 card checked every few hours, a $20 card weekly) and **rotation** (each run handles a slice of the stalest cards), and the whole thing is a few hundred *light* requests a day — well within reach without hammering eBay.

---

## The hard part: not getting blocked — and how everyone solves it

**eBay has no usable API for sold prices.** The old one was deprecated; the current sold-data API is gated to a handful of approved partners. So the honest industry reality is: **the price aggregators all scrape it**, behind rotating **residential/mobile proxies**, or they pay a **scraping vendor** to do exactly that. There is no clean, sanctioned feed to graduate to.

What actually keeps a scraper uncaught, in order of importance:
1. **Residential/mobile IP addresses** (datacenter IPs — including any cloud/CI host — are blocked on sight). This is ~80% of the battle.
2. A **realistic browser fingerprint** (already in place).
3. **Human-like pacing** — jittered delays, spread over the day, never bursts.
4. **Backing off** when challenged, rotating to a fresh IP rather than hammering.

**Build vs. buy — the one decision that unblocks everything else:**
- **Managed scraping vendor** (Bright Data, ScraperAPI, Zyte, Oxylabs, Apify…) — they own the proxies, CAPTCHA-solving, and the constant cat-and-mouse with eBay's defenses. You hand them a URL, they return the page. **Recommended to start:** lowest operational burden, most reliable, and for a core data asset the modest monthly cost is easily justified. **The plumbing is already done** — pointing at a vendor is a single configuration value, not a rewrite.
- **Self-hosted** — run our own scraper and just rent the proxies. Cheaper per request, but we own the arms race and the maintenance.

Either way it runs on an **always-on worker or the vendor's infrastructure** — never on GitHub Actions (datacenter IPs).

---

## Getting the data *right*, not just *in*

Speed is worthless if the numbers are wrong, so the precision work is already built:
- **Variant matching** — the same card's base print ($4) and alt-art parallel ($4,000+) share a set code, so a sloppy match could tag a cheap base sale onto the expensive variant's price. We check each listing's variant against the target and drop clear mismatches, flagging the ambiguous ones for review.
- **Outlier rejection** in the price calc automatically discards a sale that's wildly off a variant's going rate — a second safety net.
- **Cross-source de-duplication** so the same physical sale reported by two sources never counts twice.
- **Admin review queue** as the human backstop, with prices recomputing the instant an admin prunes a bad sale.

**Image recognition is explicitly deferred.** The printed card ID + grade in the title, plus the outlier trim and human review, handle the vast majority. Matching photos of cards *inside slabs* is hard and low-ROI for v1. If we ever do image work, the higher-value target is reading the **slab label** (cert number + grade) — not matching the artwork.

---

## What's done vs. what's waiting on a decision

**Built and tested (no infrastructure required):** target selection, per-variant search, variant matching, bad-listing flagging, cross-source dedup, and — critically — the **vendor-swappable fetch layer** so the anti-bot solution plugs in with one setting.

**Waiting on your call:**
- **Pick the ingestion path** (managed vendor vs. self-hosted). This is the gate for the always-on worker that runs the daily rotation.
- **How Alt exposes its sold data**, so the second-source adapter isn't a guess.

Once the vendor/worker is chosen, the remaining work (the rotation schedule + the worker cron) is small and lands quickly against it.

---

## What success looks like

- Every graded-worthy One Piece card refreshes its sold-sale data on a cadence matched to its value — top cards within hours.
- We're demonstrably **fresher on One Piece** than the daily-batch aggregators, because we go to the source and focus the firepower on a small, high-value set.
- The pipeline runs unattended on residential infrastructure, with a dashboard showing per-source health and a challenge-rate signal that tells us when to rotate.

## What this is *not*

- **Not real-time-everything.** Focused freshness on a niche, not a streaming firehose across all collectibles.
- **Not dependent on a sanctioned eBay feed** — there isn't one; we (like everyone) scrape, done carefully and politely.
- **Not blocked on engineering.** The code side is essentially complete; the remaining gates are a vendor choice and Alt's data source.

---

*Last updated: 2026-06-09. Technical companion: [docs/slab-ingestion.md](../docs/slab-ingestion.md). Part of the [slab-pricing](slab-pricing.md) source-of-truth effort.*
