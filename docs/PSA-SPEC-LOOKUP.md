# PSA Spec ID Lookup — Freelancer Instructions

## What you're doing

For each row in the CSV, find the matching card on PSA's Population Report
website and paste the URL back into the spreadsheet.

The CSV will be sent to you by your client. It has these columns:

| Column | What it is | What to do with it |
|---|---|---|
| `card_id` | Internal ID — for tracking | Don't change |
| `name` | Card name, e.g. "Sugar (SP)" | Use to search PSA |
| `set` | Set code, e.g. "OP10" | Use to disambiguate |
| `market_price` | TCGPlayer market price in USD | Reference (chase cards are higher) |
| `tcgplayer_url` | Link to the card on TCGPlayer | **Click this** to see the card image so you know which variant you're looking up |
| **`psa_pop_url`** | **EMPTY — you fill this** | Paste the full PSA pop report URL here |
| `notes` | Empty | Use only if a card can't be found |

---

## Step-by-step (per card)

1. **Open the TCGPlayer URL** (column E, `tcgplayer_url`) in a new tab.
   You'll see the card image and product name. This is the card you're
   looking for.

2. **Go to https://www.psacard.com/pop**

3. In the search bar, type the **card name** from column B
   (e.g. `Sugar SP` or `Monkey D Luffy alternate art`).
   Sometimes just the name alone works better than including the set code.

4. PSA's results list will appear. **Click the matching card.**
   Make sure it matches the TCGPlayer image — pay attention to:
   - The art (regular vs alternate vs manga vs super alt)
   - The set name (One Piece OP04 ≠ OP10 ≠ Eternal Booster)
   - The card number

5. You're now on PSA's card detail page. **Copy the URL** from the
   browser's address bar. It will look something like:
   ```
   https://www.psacard.com/pop/tcg-cards/2024/one-piece-tcg-the-azure-seas-seven/sugar-sp/15173631
   ```

6. **Paste the URL into column F** (`psa_pop_url`) for that row. Use the full URL.

7. Move to the next row.

---

## What to do if you can't find a card

Some cards are too new, too rare, or too cheap to have ever been graded
by PSA. If after **two minutes of looking** you can't find a card on
PSA's site:

- **Leave `psa_pop_url` (column F) blank**
- **Write `not on PSA` in `notes` (column G)** so we know you checked

Don't guess — wrong spec IDs pollute our data.

---

## Common traps

**Variant confusion.** One Piece cards have many printings of the same
character. For "Monkey.D.Luffy (OP01-001)" there might be:
- Regular Leader card
- Alternate Art parallel
- Manga variant
- SP (Special Printing)
- Promo

Each is a **different PSA card with a different URL**. The `name` column
will tell you which one — `(Alternate Art)`, `(Manga)`, `(SP)`, etc.
Always cross-reference with `tcgplayer_url` to confirm.

**Set code translation.** Our set codes (e.g. `OP10`) don't always match
PSA's set names directly. `OP10` is "The Azure Sea's Seven" on PSA.
Use the card name to anchor your search rather than the set code.

**Japanese vs English.** TCGPlayer lists both. Our cards are English by
default — only flag Japanese if the `name` column explicitly says so.

---

## Example: a correctly-filled row

Before (what you receive):
```
card_id,name,set,market_price,tcgplayer_url,psa_pop_url,notes
OP10-065_p1,Sugar (SP) - OP10-065,OP10,153.48,https://www.tcgplayer.com/product/671455,,
```

After (what you send back):
```
card_id,name,set,market_price,tcgplayer_url,psa_pop_url,notes
OP10-065_p1,Sugar (SP) - OP10-065,OP10,153.48,https://www.tcgplayer.com/product/671455,https://www.psacard.com/pop/tcg-cards/2024/one-piece-tcg-the-azure-seas-seven/sugar-sp/15173631,
```

---

## When you're done

Save the file as `psa-spec-filled.csv` (or whatever the client asked)
and send it back. The client will run a script that automatically
parses the spec IDs from your URLs.
