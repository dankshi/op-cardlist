# Admin Site Overhaul — Design Summary

> Human-readable version for sharing with stakeholders or pasting into Google Docs. Decision-and-rationale only; for the technical implementation see [docs/admin-site-overhaul.md](../docs/admin-site-overhaul.md).

---

## What we're building

The admin area is now **its own application**, not a back room you reach by walking through the customer storefront. Three changes:

1. **Its own look.** No more orange consumer header, search bar, and footer wrapped around every admin page. Admin is a clean, light, internal tool with a neutral indigo accent — it reads as "staff software," not "the shop."
2. **A top navbar instead of a sidebar.** Hover **Orders** and a menu drops down with every order status (Exception Review, Paid, Received, Authenticated, …) — click one to jump straight to that queue. Same for Fulfillment (Intake, Pack, Issues, Risk, Inventory), Data, and Community. Keyboard- and touch-friendly, not just hover.
3. **A master view for every order.** Each order's page now shows *everything in the database* about that order — not a polished summary that hides the fields ops actually need.

Nothing moved for customers: every storefront URL is byte-for-byte the same.

---

## Why this is worth doing

**1. Admin had no identity of its own.** It inherited the storefront chrome, so it always felt like a bolt-on. Giving it a dedicated shell + top-nav makes it feel like a real operations console and frees it to evolve without worrying about matching the consumer site.

**2. The order page was hiding the data ops needs.** The old detail page showed a friendly subset — buyer, seller, a few statuses. But when something goes wrong, ops needs to *match records across systems*: the `order_items.id` encoded in a Product QR, the `listing_id` it came from, the Stripe payment-intent ID, who authenticated it and when, the exact exception details, the buyout/consignment/credit rows. None of that was visible. The master view surfaces **every field**, with one-click copy on every ID.

**3. Jumping to a status queue was clunky.** Finding "all orders waiting on authentication" meant loading the full list and scrolling to the right accordion section. Now it's one hover and a click from anywhere in admin.

**4. The codebase was duplicating itself.** Status colors and labels were copy-pasted across pages and drifting. They now live in one place that the navbar, the list, and the order page all share.

---

## How we're doing it

### The shell split

```
Before:  one front door — everyone (customers + staff) walks
         through the orange storefront lobby to reach any page,
         admin included.

After:   a customer wing (orange storefront chrome) and a staff
         wing (plain admin shell), sharing only the bare building
         (the <html> shell). URLs unchanged — the split is invisible
         in the address bar.
```

Technically this is a Next.js "route group": storefront pages moved into a `(site)` folder that carries the orange chrome, admin got its own layout, and the shared root shrank to nothing but the page skeleton. The whole admin section is now gated in one place — non-admins are bounced before any admin page renders.

### The navbar

A sticky top bar. Top-level items open dropdowns on hover (with a small grace delay so the menu doesn't vanish as your cursor travels to it), on keyboard focus (Tab works), and on tap (mobile). The **Orders** menu is the star: a labeled, color-dotted list of every status that links straight to that filtered queue.

### The master view

Open any order and you get, top to bottom:

- **Header** — full order ID (copyable), live status, and the fulfillment pipeline stepper.
- **Quick actions** — print labels, mark received/shipped, generate the outbound label, resolve an exception — all the buttons that were there before, kept intact.
- **Order record** — every column on the order: all the money fields and fee breakdown, every timestamp, the Stripe IDs, the risk-review fields, the fraud flags.
- **Parties & shipping** — full buyer and seller records, the shipping address, and both shipping legs (inbound from seller, outbound to buyer) with tracking and label links.
- **Items** — for each card: **every** column, including the item ID and listing ID ops kept asking for, the authentication decision and condition, intake status, damage notes, plus the original listing snapshot and any buyout/consignment record, all copyable.
- **Related records** — intake issues, the activity log, consignments, buyouts, reviews, and credit transactions tied to the order.

A nice property: because the page renders fields generically, **any new database column shows up automatically** — the master view won't silently fall behind the schema.

---

## What's explicitly out of scope

- **No schema changes.** This is purely a read + presentation layer over data we already store.
- **No new permission tiers.** Access is still the single `is_admin` flag — every admin sees everything, same as before.
- **The other admin sub-pages** (Intake, Pack, Authentication, etc.) keep their current internals; they simply now live inside the new shell and top-nav. Restyling their bodies to the new palette can follow later.
