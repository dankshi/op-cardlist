# Admin Edit Cards — Design Summary

> Human-readable version for sharing with stakeholders, partners, or pasting into Google Docs. Decision-and-rationale only; technical implementation lives in `src/app/admin/cards/page.tsx`, `src/components/admin/CardEditor.tsx`, and `src/app/api/admin/cards/[cardId]/route.ts` (PATCH) + `[cardId]/detail/route.ts` (GET).

---

## What we're building

An admin "command center" for inspecting and editing the metadata of any card in our catalog. It replaces the old workflow of editing rows in Supabase Studio (slow, no validation, no audit) and the scattered inline-edit affordances on `/admin/psa-pops`, `/admin/mappings`, and the public card detail page.

Two surfaces:

1. **List view** at `/admin/cards`. Every card in the catalog, grouped by set, searchable + filterable. Sets default-open when they have ≤30 cards, collapsed when larger. Each tile shows the card image, name, id, rarity, art_style, and a "click to edit" affordance. Visible-only / hidden-only / all toggle.
2. **Command center modal.** Click any tile → modal opens with the same dark "VSCode-style" debug block from the public card detail page, but with editable controls inline. Joins data from three tables (`cards`, `card_tcgplayer_mapping`, `pops_psa`) so the admin sees the full picture of a card's metadata + market mappings + PSA pop spec in one place. Plus a paste-TCG-URL input as a manual override for when the auto-mapper got it wrong.

---

## Why this is worth doing

Three reasons.

**1. The scraped data is wrong sometimes.** Bandai's catalog is the source of truth but has its own quirks — PRB box-pull rarities, `_r*` reprints labeled as new variants, PRB `_p*` cards that semantically should be `'standard'` art_style despite the underscore suffix. We've been hand-correcting these in Supabase Studio for months. Doing it in a purpose-built UI is faster and less error-prone.

**2. The PSA pop matcher needs human eyes.** The matcher is decent but not perfect — fuzzy name matches need a human to confirm. The PSA pop admin page handles the matching side, but to actually fix a card's metadata (rarity, art_style) you had to open Supabase Studio. The command-center modal closes that loop: see the wrong rarity in the debug block, click the dropdown, fix it, the entire `/admin/psa-pops` re-derives correctly on next page load.

**3. Onboarding ops will be impossible without it.** Today only the founder knows which fields are editable and which aren't. Putting every editable field behind clear inline controls — with valid options enforced — means a new ops person can correct catalog data without being trained on the schema.

---

## How it changes the workflow

**For the founder editing catalog data:**
Before: open Supabase Studio in another tab, filter `cards` by id, double-click cells, hope you remembered which values are valid (`'standard'` vs `'Standard'` vs `'STANDARD'`), refresh the public site to confirm the change took effect.
After: open `/admin/cards`, search the card by name or id, click the tile, change the dropdown, see the green ✓ confirmation, done. No tab switching, no enum guessing.

**For correcting a PSA pop mismatch:**
The fuzzy-match candidates on `/admin/psa-pops` sometimes need a rarity correction on our side to clean up the match. Before: switch to Studio, fix the rarity, come back. After: open the command center on the card, fix the rarity inline, the PSA pop page picks up the change on next refresh.

**For checking what TCGplayer product a card maps to:**
Before: query `card_tcgplayer_mapping` directly. After: open the modal — the mapping row is right there in the `card_prices` section of the debug block, with a live link to the TCG product page for verification.

---

## Key design decision: read-only `variant`, even though we have the column

The big decision is **which fields are editable.** Today: only `art_style` and `rarity`. Everything else — `name`, `type`, `effect`, `image_url`, `variant`, `is_parallel`, `colors`, `traits`, etc. — is **read-only** even though the schema would allow editing them.

The reasoning:

- **`variant` and `is_parallel` are structural** — they're derived from the Bandai card id's underscore suffix. Letting an admin override them creates inconsistency between the ID and the metadata. We removed `is_parallel` from the schema entirely after confirming it was always equal to `variant != null`; `variant` itself is now read-only.
- **`name`, `type`, `effect`, `image_url` come directly from Bandai's catalog.** If they're wrong, the fix is to fix our scraper or wait for Bandai to correct their page — not to bandage it in our DB where the next scrape will overwrite the manual edit.
- **`rarity` is mostly correct from Bandai** but has the PRB box-pull quirk where Bandai's listed rarity doesn't match the card's intrinsic rarity. Editable so the founder can override on a case-by-case basis.
- **`art_style` is fully inferred by our scraper** and is the most-frequently-wrong field. Editable.

The principle: editable fields are ones where our judgment is the source of truth and we want it persisted across scrapes. Read-only fields are ones where Bandai is the source of truth and we trust the scraper to keep them current.

This is paired with the related scraper change: the scraper now writes `rarity` on every run (overwriting any manual edits — we accept this because it's rarely wrong) but writes `art_style` only on the *first* sight of a new card (preserving manual edits forever). The two design decisions support each other.

---

## What the modal shows

The debug block is laid out as three "sections" matching the joined tables:

```
# debug: data sources
cards
  id          OP13-001
  name        Monkey D. Luffy
  rarity      [SR ▼]              ← editable dropdown
  type        LEADER
  art_style   [alternate ▼]       ← editable dropdown
  variant     p1                  ← read-only
  is_parallel true                ← read-only (now removed)
  bandai_url  https://...         ← clickable, verify against source

card_prices
  tcg_name    Monkey D. Luffy (Alternate Art)
  tcg_url     https://www.tcgplayer.com/product/...
  source      manual
  update      [Or paste TCG URL: ___________] [Assign]

pops_psa
  set_code    op-13
  spec_id     12345678
  description Monkey D. Luffy (Alt Art)
  variety     Alternate Art
  card_number 001
  total_pop   847
  psa_url     https://www.psacard.com/spec/psa/...
```

Loaded lazily via `GET /api/admin/cards/[id]/detail` so the list view stays cheap (single query for the whole catalog). The modal hits the detail endpoint only when opened.

---

## What this costs us

- **Engineering time:** roughly 1 day of focused work for the list page + modal + detail endpoint + threading the existing inline-edit components together.
- **Ongoing operational:** none beyond the manual-edit time itself, which was already happening in Supabase Studio.
- **Admin-only surface:** RLS protects the `cards` table from anon/authenticated writes; the PATCH endpoint goes through the service-role client after an admin check.

---

## What this saves us

- **Catalog cleanup velocity.** A back-of-envelope: 30 cards/week corrected, 30 seconds saved per correction (Studio vs. modal), 15 minutes/week of founder time. Small per week, real per year.
- **Cleaner PSA pop matching.** Fast metadata correction means the matcher can be re-run with confidence and the unmapped queue drains faster.
- **Lower onboarding cost for ops.** A new ops hire needs hours to learn the schema; minutes to learn the modal.

---

## What success looks like

- **All catalog corrections happen through the modal**, not Supabase Studio. If anyone is still editing in Studio after 30 days the affordance is wrong or there's a missing editable field.
- **Modal load time < 500ms** for the detail fetch. The view is interactive and any latency makes the "make a quick correction" flow feel sluggish.
- **Zero data loss on re-scrape.** Manual `art_style` edits made through the modal must survive every subsequent `npm run scrape`. (Tested by the seedArtStyles pattern in `scrape-bandai-cards.ts`.)
- **No accidental edits to read-only fields.** If anything that *shouldn't* be editable becomes editable through a future change, it should fail loudly (PATCH endpoint rejects unknown fields by design).

---

## What this is *not*

- **Not a card creation tool.** New cards come from the scraper. The modal is for editing existing rows.
- **Not for editing prices or listings.** Those belong to the `card_tcgplayer_mapping` flow and the seller's `/sell/[id]/edit` page respectively. The modal exposes the mapping for context but the actual TCG product assignment goes through the dedicated `ManualUrlAssign` component embedded in the debug block.
- **Not an audit log.** Edits don't write to an audit table; the `updated_at` column is the only trace. Adequate for a single-founder operation; would need rethinking with multiple ops people.
- **Not a deletion tool.** No way to delete a card from the catalog. Cards that shouldn't be sellable get hidden via the visibility rules, not deleted.

---

## Decisions still open

- **Bulk edit.** Today every edit is one-card-at-a-time. A "fix art_style for all matching rows" tool would be useful for things like the 267-row `_r*` backfill we did manually. Worth building when the next similar situation comes up.
- **Audit log.** When we hire ops support, knowing who edited what becomes load-bearing. Probably a `card_edits` table with `(card_id, field, old_value, new_value, edited_by, edited_at)` columns.
- **Inline-editable PSA spec link.** Currently the `pops_psa` section is read-only in the modal. Re-linking a spec still has to happen from `/admin/psa-pops`. Worth threading the PsaSpecLinkButton component in eventually so all card-related ops live in one modal.
- **Expand to other catalogs.** When we add Pokemon, the modal needs a TCG-agnostic shape (or a parallel `/admin/cards/pokemon` route). Punted until the second TCG is actually live.

---

*Last updated: 2026-05-21. Live UI: see [src/app/admin/cards/page.tsx](../src/app/admin/cards/page.tsx) and [src/components/admin/CardEditor.tsx](../src/components/admin/CardEditor.tsx).*
