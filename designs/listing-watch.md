# Listing Watch — get pinged the instant a rare card is for sale

## The problem

Everything we track about TCGplayer prices is built on **completed sales** — what
a card *sold* for. That's great for valuing a collection, but it's the wrong tool
for chasing a rare card. By the time a sale shows up in our data, someone else
has already bought it. We find out a card was available *after* it's gone.

For a genuinely rare card — like the **Monkey.D.Luffy CS 25/26 championship
promos** — what you actually want is the opposite: a heads-up the **moment a
listing goes live**, so you can be the one who buys it.

## What we built

A **watcher** that checks TCGplayer for *live listings* of specific cards we care
about, and fires a **Discord message** the instant a new one appears. It runs on
its own every 5 minutes, around the clock.

The alert tells you everything you need to decide in one glance: **price** (plus
shipping), **condition**, **quantity**, and **who's selling** (their name, rating,
and sales count), with a link straight to the product page.

Each listing is alerted **exactly once**. The watcher remembers every listing it's
already told you about, so you get one ping per new listing — never a repeat of
the same one every five minutes.

## What's being watched right now

Two cards, both seeded and live:

- **Monkey.D.Luffy — CS 25/26 Top Player Pack**
- **Monkey.D.Luffy — CS 25/26 Finalist Card Set 1**

Adding more later is a one-line database entry — any TCGplayer product can be
watched, whether or not it's a "normal" card in our catalog.

## Good to know

- **The first ping covers what's already listed.** When a watch goes live, any
  listings that are *currently* up will alert too — for these rare cards that's
  exactly what you want (there might already be one for sale). If you ever add a
  watch and *don't* want the existing backlog, we can onboard it silently.
- **A hiccup never spams you.** If TCGplayer briefly blocks the check, the watcher
  treats it as "nothing new this minute," not "everything's new" — so a blip can't
  turn into a flood of duplicate alerts.
- **A missed send is retried, not lost.** If Discord is down when a new listing
  appears, the watcher doesn't mark it as handled — it'll alert on the next run
  instead of quietly dropping it.

## Where the alerts go

The same Discord channel that already gets the scraper's status updates. No new
setup beyond pointing the watcher at that webhook.
