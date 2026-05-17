# How PSA Population Data Works

This doc explains the reasoning behind how PSA grading population data
flows into our site — not the SQL or the code, just the logic. If you're
ever wondering "why does it work this way?" or "why can't we just do X?",
this is the place.

---

## What we're trying to do

When someone looks at a card on our site, we want to show how many copies
of that card PSA has graded at each grade — 10 of them got a PSA 10, 50
got a PSA 9, etc. This information lives on PSA's website (the "pop
report"), and we want to mirror it into our database so it shows up next
to the card's price.

---

## Why PSA's official API isn't enough

PSA has a public API, but it only lets you look up **one card at a
time**, by something they call a SpecID (their internal ID for a specific
card printing). To get pop data for a 119-card set like OP08, you'd have
to make 119 separate API calls AND you'd need to already know all 119
SpecIDs in advance. There's no "give me everything in this set" endpoint.

We worked around that by using the same endpoint that PSA's own website
uses internally to render their pop pages. It's not documented and
requires us to send the same browser cookies a logged-in user would. The
upside: one request returns every card in a set in a single JSON blob.

The cookie matters because PSA puts this endpoint behind anti-bot
protection. The cookie effectively says "this request came from a real
browser that already proved it's human." Cookies expire after about a
day, so when our fetches start failing, we just copy a fresh cookie from
a browser into the config and rerun.

---

## The cards-vs-PSA-specs mismatch

The trickiest part of this whole system is that **PSA's idea of a "card"
and ours don't line up cleanly.** We use the bandai card ID (like
`OP08-001`) and we tack on suffixes for variants (`OP08-001_p1`,
`OP08-001_p2`, etc.). PSA uses their own internal SpecIDs (like
`11842748`) with a separate "Variety" label like `"Alternate Art"` or
`"Special Alternate Art"`.

So for every card PSA has, we need to figure out which of our cards it
corresponds to. That mapping is what most of this system is doing.

We store the mapping in a table called `pops_psa`. Each row is one PSA
spec — every card PSA has graded, regardless of whether we've figured
out what our equivalent is yet. Rows without a mapping are the
"to-do list" of cards a human needs to map manually.

---

## What variants look like, and why they're confusing

A single character can appear in our database multiple times — once for
the base card and once for each variant printing:

- `OP08-001` — the regular card
- `OP08-001_p1` — the Parallel (also called "Alternate Art")
- `OP08-001_p2` — the SP (Special Alternate Art)

The `_p1` / `_p2` numbering is arbitrary and **not consistent across
cards**. For one character `_p1` is the Parallel and `_p2` is the SP;
for another it might be the reverse. The only way to tell which is which
is by looking at the TCGplayer name attached to each card_id, which
contains labels like `(Parallel)`, `(Manga)`, `(SP)`, or `(TR)`.

PSA, meanwhile, doesn't say `_p1`. They say things like:

- `Variety: ""` → the base card
- `Variety: "Alternate Art"` → the Parallel
- `Variety: "Manga Alternate Art"` → the Manga version
- `Variety: "Special Alternate Art"` → the SP
- `Variety: "Treasure Rare"` → the TR
- `Variety: "Pre-Release"` → a pre-release promo

So matching a PSA spec to our card means **translating between two naming
conventions that agree on the character but disagree on everything else**.

---

## The auto-matching logic, in plain English

For each PSA spec returned by the website, we try to figure out which of
our cards it is. The rules depend on the Variety:

**For base cards** (Variety is empty): PSA's CardNumber equals our
bandai number. So if PSA says `CardNumber: "002"` in OP08, that maps to
our `OP08-002`. Easy.

**For Alternate Art**: PSA still uses the same CardNumber as the base
card (because it IS the same card, just a parallel print). So we look
through the `_p1`/`_p2`/etc. variants of `OP08-002` and pick the one
whose TCGplayer name has `(Parallel)` in it — but only if it doesn't
also say `(Manga)` or `(SP)` or `(TR)`. If there's exactly one match,
we lock it in.

**For Manga Alternate Art**: Same idea, but we look for `(Manga)` in
the TCGplayer name.

**For Special Alternate Art (SP) and Treasure Rare (TR)**: This is
where it gets tricky — see the next section.

**For anything else** (Pre-Release, Don!! Card, etc.): we leave it
unmapped for human review. Either we don't track these as separate cards
in our database, or the matching logic is too ambiguous to trust.

In every case, the match only happens if there's **exactly one** card it
could possibly be. If two cards could match, or zero, we leave it
unmapped rather than guess wrong.

---

## The Special Alternate Art / Treasure Rare gotcha

This one tripped us up. PSA reuses the CardNumber of a card's **original
printing** for SP and TR reprints. So if Portgas D. Ace first appeared
in OP02 as card 013, and gets an SP reprint in OP08, PSA labels the OP08
SP card as "CardNumber 013" — even though OP08's actual card 013 is a
completely different character (Robson).

That means for SP and TR specs, we can't just take PSA's CardNumber and
prepend the current set code. We have to search **across all sets** in
our database for a card matching that CardNumber, then narrow it down
by character name and the `(SP)` or `(TR)` marker.

Concretely: PSA says "OP08 set has a Special Alternate Art for CardNumber
013, character Portgas D. Ace." We search every card in our database
ending in `-013_p<something>`, filter to ones where the TCGplayer name
contains "Portgas D. Ace" (with normalization for punctuation
differences), and then to ones marked `(SP)`. We end up with
`OP02-013_p3`, which is correct.

This is why we store PSA's raw CardNumber in its own column
(`psa_card_number`) instead of synthesizing a fake `OP08-013` string
into the description. The raw number is useful for lookup; the fake
synthesized version is actively misleading because it implies a
mapping that doesn't exist.

---

## Why we can't fully separate this from TCGplayer

The annoying truth is that **TCGplayer's product name is the only source
in the entire pipeline that tells us a variant's type.** Bandai (where
our card IDs come from) doesn't say which `_p1` is a Parallel vs SP vs
Manga — Bandai just gives us the card ID and an image. Our scraper has
a small hand-curated list of manga and wanted-poster cards, but
everything else just defaults to "alternate" with no further detail.

So the chain looks like this:

```
Bandai gives us:          card_id + an image of the card
A human matches that to:  the TCGplayer listing showing the same image
TCGplayer gives us:       a product name like "Charlotte Pudding (SP)"
We read variant type from: that product name's "(SP)" tag
```

There's no shortcut around this. PSA also doesn't tell us in a clean
structured way — they just say "Variety: Special Alternate Art" as a
free-text label. The actual "this card is the SP printing" knowledge
only lives in TCGplayer's strings.

The implication for our system: if someone fixes a wrong TCGplayer
mapping later (because we'd linked the wrong product), then any PSA
matches that depended on the old name are now wrong. They'll sit there
silently mapped to the wrong card. So **whenever TCGplayer mappings get
corrected, the PSA matcher should be re-run** to refresh those matches.

---

## How we catch broken mappings

Because the dependency above is a real fragility, we have two safety
nets so mismatches don't sit invisible forever.

**The admin page** lives at `/admin/psa-pops`. Every time you open it,
it pulls the current state of `pops_psa` together with each linked
card's current TCGplayer name, and flags any rows where the two
disagree. Concrete examples of what gets flagged:

- PSA says the spec is `(Special Alternate Art)` but the linked card's
  TCGplayer name doesn't say `(SP)` anymore
- PSA says it's `(Alternate Art)` but the linked card says `(Manga)` or
  `(SP)`
- The linked `card_id` no longer exists in `card_prices` at all (the
  card was renamed or deleted)

The check is symmetric and recomputed live: it doesn't care whether
someone edited the TCGplayer side or the PSA side, and there's no cached
result to invalidate. Edit a row in Supabase Studio, refresh the admin
page, see the new state immediately.

**The `--rematch` flag** on the fetcher (`scripts/psa-pop-fetch.ts
--rematch`) is the bulk fix. Normally the fetcher leaves existing
`pops_psa.card_id` values alone — it only fills in missing ones. With
`--rematch`, it ignores all existing assignments and re-derives every
card_id from scratch using current TCGplayer data. Use this after
fixing a batch of TCGplayer mappings, when you don't want to manually
go correct each stale `pops_psa` row.

Workflow when you fix a wrong TCGplayer mapping:
1. Fix the mapping in `card_prices` (via the `/test` page or directly).
2. Visit `/admin/psa-pops` to see what's flagged stale.
3. Either correct individual rows in Supabase Studio, or run
   `npx tsx scripts/psa-pop-fetch.ts --rematch` to redo all of them at
   once.

---

## When something goes wrong

A few common failure modes and what they mean:

**Fetches start returning 403.** PSA's anti-bot cookie expired. Open a
browser, log into PSA, copy the cookie out of DevTools, paste it into
`.env.local`, run again.

**A card has the wrong PSA mapping.** Most likely the underlying
TCGplayer mapping is wrong (or was when we last matched). Fix the
TCGplayer mapping, then re-run the matcher to refresh.

**A bunch of cards show up as unmapped that look mappable.** Almost
certainly Pre-Release variants, which we don't track as separate cards
in our database. They sit in `pops_psa` with no mapping but they don't
actually correspond to anything we can show.

**Brand-new variety strings appear from PSA.** PSA might invent a new
Variety label one day ("Cosmic Alternate Art" or whatever). The matcher
will just skip those and leave them unmapped. We update the auto-match
rules to handle the new one whenever it shows up.

---

## Where in the codebase this lives

If you actually need to change something:

- The fetcher and auto-matcher: `scripts/psa-pop-fetch.ts`
- The database table: see migrations under `supabase/migrations/` named
  `*pops_psa*`
- The card-page UI that displays the pops: `getCardPopulations()` in
  `src/lib/price-history.ts`, rendered by `CardPopulations.tsx`
- The cookie: `PSA_WEB_COOKIE` in `.env.local`
