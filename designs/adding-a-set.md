# Adding a New Set — Design Summary

> Human-readable version for sharing with stakeholders, partners, or pasting into Google Docs.
> Decision-and-rationale only; for the step-by-step technical runbook see
> [docs/adding-a-set.md](../docs/adding-a-set.md).

---

## What this is

Every couple of months Bandai releases a new One Piece TCG set (OP-16, then OP-17, the occasional EB
or PRB set). For our catalog to stay current we have to pull each new set's data in from two outside
sources and stitch them together:

1. **Bandai's official cardlist** — the source of truth for *what the cards are*: names, types,
   colors, rarities, abilities, the variant/parallel arts, and the official card images.
2. **TCGplayer** — the source of truth for *what the cards are worth*: market prices and recent sales,
   plus the sealed booster-box photo we show on the set tile.

Bringing a set in is a fixed sequence of six steps. This doc explains the sequence and, more
importantly, *the timing* — because the two sources don't become ready at the same time, and doing the
work in the wrong order creates avoidable rework.

---

## The key decision: two phases, not one

The single most important thing to understand is that **Bandai publishes a set weeks before TCGplayer
prices it.**

- Bandai posts a set's full cardlist (often a month) ahead of the street date, so we can show every
  card and image early — a real advantage over competitors who wait.
- TCGplayer only starts listing the individual **singles** around or after release. (Confusingly, the
  sealed *booster box* gets a TCGplayer page even earlier — but that's one product, not the 150+
  singles we price.)

So we split the work:

- **Phase A — the moment Bandai posts the set:** pull in all the cards, mirror the images to our own
  storage, and grab the booster-box tile photo. The set goes live in the catalog, fully browsable,
  with no prices yet.
- **Phase B — once TCGplayer has the singles:** match each of our cards to its TCGplayer product and
  start pulling prices and sales.

**Why we don't just do it all at once:** if we run the price/matching step before TCGplayer has
listed the singles, we get a half-empty, constantly-shifting set of card→product links that we'd then
have to re-run and manually reconcile. Waiting until the data actually exists turns a messy,
repeated job into a clean one-shot.

---

## What protects us from breaking existing data

A recurring worry with a re-runnable import is "will this clobber what's already there?" The pipeline
is built so the answer is no:

- **It only touches the set you name.** Every other set in the catalog is left exactly as-is.
- **Human corrections always win.** Once someone has hand-fixed a card's art style or its price
  mapping, re-running the import never overwrites that. New auto-generated guesses that *disagree* with
  an existing human fix get parked in a review queue instead of silently replacing it.
- **Re-running is safe.** Each step can be run again with no harm — useful when TCGplayer fills in more
  cards over the weeks after release and we want to top up the prices.

This means catalog staff can re-run the pipeline freely to pick up late-arriving data without fear of
undoing curation work.

---

## What it looks like when a set lands

- **Day the cardlist posts:** the set appears on the site with every card, official art, and the box
  image — but card pages show "no price yet." (Phase A.)
- **Around release:** prices and recent-sales data fill in as TCGplayer lists the singles; the team
  spot-checks the handful of high-value chase cards and resolves anything the matcher flagged for
  review. (Phase B.)
- **Ongoing:** the daily price refresh keeps the set current alongside every other set.

---

## Why this is written down

Adding a set used to mean reconstructing the process from scattered, partly-outdated notes each time —
which risked re-doing work or overwriting data. It's now a single checklist with a fixed order and
clear "do this now vs. wait" timing, so the next set (OP-17 and beyond) is a 20-minute, low-risk job
that anyone on the team can follow.
