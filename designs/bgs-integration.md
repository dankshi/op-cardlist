# Beckett (BGS) — cert lookup & population

We already pull **PSA** population (how many of each card exist at each grade) and
map PSA's data to our cards. This brings **Beckett (BGS)** to the same level, with
one bonus: looking a slab up by its **cert number**.

## Two things we want

**1. Cert lookup — type the cert, we fill in the rest.**
When you log a BGS slab, instead of hand-entering the grade and all four subgrades
(Centering / Corners / Edges / Surface), you'd enter the **cert number** and we'd
fetch the real grade + subgrades straight from Beckett and fill them in. Faster,
and no typos.

**2. Population — "how rare is this grade?"**
Like the PSA population we already show, we'd display how many copies Beckett has
graded of a card at each grade (including Black Label and the half-grades like
9.5). It shows up automatically wherever the card's grades already appear.

## The catch

Unlike PSA, **Beckett doesn't offer an official data feed.** Their cert lookup is
a public web page we can read, but their **population report sits behind a paid
account**. So:

- **Cert lookup is the easy win** — public page, big convenience, no surprises.
- **Population is doable but depends** on getting at Beckett's pop data (likely a
  paid Beckett login). That's the one thing we need to confirm first.

## How it rolls out

1. **Quick research check** — confirm we can reliably read Beckett's cert page,
   and figure out how to reach their population data.
2. **Cert lookup first** — the "type the cert, autofill the grade + subgrades"
   button. Self-contained and high-value.
3. **Population next** — mirrors exactly what we built for PSA (a scraper, an admin
   page to match Beckett's entries to our cards, and the card page picking it up).
   Most of the plumbing already exists from the PSA work.

## Good news

Almost everything else is already in place from the grading feature — the BGS
grade scale, the four subgrades, cert storage, and the card page's BGS column all
exist. This is mostly **cloning the PSA setup for Beckett**, plus the new cert
lookup.
