# Our own raw-card price — alongside TCGplayer

## The problem

For raw (ungraded) cards we show **TCGplayer's market price**, taken as-is.
TCGplayer's number is based on real sales, but **how** it's calculated is a black
box — we don't know the time window, how much recent sales are weighted, or how
they throw out weird outliers. It can also be slow to react and get "stuck" on
cards that don't sell often.

Meanwhile, for **graded** cards we already compute our *own* value from actual
sales, with a clear, tunable method and a confidence rating. So today the site
runs on two different philosophies: graded = our transparent model, raw = a
vendor's mystery number.

## What we're doing

Compute our **own market value for raw cards too**, from the real sold prices we
already collect, using the **exact same method as graded cards**. Start with
**Near Mint** only — that's the condition TCGplayer's headline price reflects, so
the two numbers are apples-to-apples.

Crucially, **we show both** for now: our value *next to* TCGplayer's, with the
percentage difference. Nothing changes about what the site "uses" yet — this is
so we can watch how far our number drifts from TCGplayer's before trusting it.

## What you get

- **One consistent way** to value the whole portfolio (raw + graded), instead of
  two.
- **Transparency:** every value carries a confidence level (high / medium / low),
  how many sales it's based on, the time window, and a 30-day trend — none of
  which TCGplayer shows.
- **Robustness on our terms:** we explicitly ignore absurd outlier sales and
  weight recent sales more, rather than relying on TCGplayer's hidden smoothing.

## Honest limitation

Right now our raw sales come only from TCGplayer's feed, so our number will track
theirs closely — this is about *owning and explaining* the number, not magically
making it more accurate. The way to genuinely beat TCGplayer is to blend in other
sales sources (e.g. eBay, which we already scrape for graded cards). That's a
natural next step.

## Where it appears today

Only in the **admin debug view** on a card page (a small "ours vs TCGplayer"
readout with the % difference). Once the numbers look trustworthy, the next step
is to surface our value in the actual buy box and portfolio valuation, with
TCGplayer shown as a secondary reference.

## Roadmap

1. ✅ Compute + store our NM value; show both in the admin debug view *(this
   change)*.
2. Watch the drift; tune the model if needed (all knobs are in one place).
3. Promote our value to the headline price + portfolio valuation (TCG as
   fallback when our sample is thin).
4. Add more conditions (LP/MP) and more sales sources (eBay raw) for values that
   are genuinely better than any single vendor's.
