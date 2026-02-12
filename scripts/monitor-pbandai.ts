import * as fs from "fs";
import * as path from "path";
import "dotenv/config";

// ── Config ──────────────────────────────────────────────────────────
const SITEMAP_URL = "https://p-bandai.com/us/sitemap-product_1.xml";
const STATE_FILE = path.join(__dirname, "..", "data", "pbandai-state.json");
const POLL_INTERVAL_MS = 30_000; // 30 seconds
const DISCORD_WEBHOOK_URL = process.env.PBANDAI_DISCORD_WEBHOOK;

interface WatchItem {
  id: string;
  imageUrl: string; // first image from sitemap, used to check if live
  firstSeen: string; // ISO timestamp
}

interface State {
  etag: string;
  productIds: string[];
  watchList: WatchItem[]; // products detected but not yet live
}

// ── State management ────────────────────────────────────────────────
function loadState(): State {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    return { watchList: [], ...data };
  } catch {
    return { etag: "", productIds: [], watchList: [] };
  }
}

function saveState(state: State) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ── Product liveness check ──────────────────────────────────────────
async function isProductLive(imageUrl: string): Promise<boolean> {
  if (!imageUrl) return false;
  try {
    const res = await fetch(imageUrl, { method: "HEAD", headers: { "User-Agent": "Mozilla/5.0" } });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Sitemap fetching ────────────────────────────────────────────────
interface SitemapProduct {
  id: string;
  imageUrl: string;
}

async function checkSitemap(
  lastEtag: string
): Promise<{ changed: boolean; etag: string; products: SitemapProduct[] }> {
  const res = await fetch(SITEMAP_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      ...(lastEtag ? { "If-None-Match": lastEtag } : {}),
    },
  });

  const etag = res.headers.get("etag") || "";

  if (res.status === 304) {
    return { changed: false, etag: lastEtag, products: [] };
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const xml = await res.text();

  // Parse each <url> entry for product ID and first image
  const products: SitemapProduct[] = [];
  const entries = xml.matchAll(/<url>([\s\S]*?)<\/url>/g);
  for (const entry of entries) {
    const block = entry[1];
    const idMatch = block.match(/\/item\/([A-Z0-9]+)/);
    const imgMatch = block.match(/<image:loc>([^<]+)<\/image:loc>/);
    if (idMatch) {
      products.push({
        id: idMatch[1],
        imageUrl: imgMatch ? imgMatch[1] : "",
      });
    }
  }

  return { changed: true, etag, products };
}

// ── Discord notification ────────────────────────────────────────────
async function notifyDiscord(message: string) {
  if (!DISCORD_WEBHOOK_URL) {
    console.log("  (Discord not configured — set PBANDAI_DISCORD_WEBHOOK in .env)");
    return;
  }

  const res = await fetch(DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: message }),
  });

  if (!res.ok) {
    console.error(`  Discord webhook failed: ${res.status}`);
  } else {
    console.log("  Discord notification sent!");
  }
}

// ── Single poll ─────────────────────────────────────────────────────
let consecutiveErrors = 0;

async function poll(): Promise<{ newCount: number }> {
  const state = loadState();
  const time = new Date().toLocaleTimeString();

  try {
    // ── Check watch list for products that went live ──
    if (state.watchList.length > 0) {
      console.log(`  👀 Checking ${state.watchList.length} watched product(s)...`);
      const stillWatching: WatchItem[] = [];
      const nowLive: WatchItem[] = [];

      for (const item of state.watchList) {
        const live = await isProductLive(item.imageUrl);
        if (live) {
          nowLive.push(item);
        } else {
          stillWatching.push(item);
        }
      }

      if (nowLive.length > 0) {
        console.log(`  ✅ ${nowLive.length} product(s) NOW LIVE:`);
        for (const item of nowLive) {
          console.log(`    → https://p-bandai.com/us/item/${item.id}`);
        }
        const links = nowLive
          .map((item) => `- https://p-bandai.com/us/item/${item.id}`)
          .join("\n");
        await notifyDiscord(
          [
            `✅ **${nowLive.length} product(s) now LIVE on Premium Bandai USA!**`,
            "(Previously detected but were 404 — now accessible)",
            "",
            links,
          ].join("\n")
        );
      }

      state.watchList = stillWatching;
    }

    // ── Check sitemap for new products ──
    const result = await checkSitemap(state.etag);

    if (!result.changed) {
      process.stdout.write(`\r[${time}] No changes (304) | watching: ${state.watchList.length}          `);
      saveState(state); // save updated watch list
      consecutiveErrors = 0;
      return { newCount: 0 };
    }

    const productIds = result.products.map((p) => p.id);
    console.log(`\n[${time}] Sitemap updated! ${productIds.length} products`);

    if (state.productIds.length === 0) {
      console.log(`  First run — saving ${productIds.length} products as baseline`);
      saveState({ etag: result.etag, productIds, watchList: state.watchList });
      consecutiveErrors = 0;
      return { newCount: 0 };
    }

    // Build lookup for image URLs
    const imageMap = new Map(result.products.map((p) => [p.id, p.imageUrl]));

    // Find new products
    const oldSet = new Set(state.productIds);
    const newProducts = productIds.filter((id) => !oldSet.has(id));

    // Find removed products
    const newSet = new Set(productIds);
    const removedProducts = state.productIds.filter((id) => !newSet.has(id));

    if (newProducts.length > 0) {
      console.log(`  🆕 ${newProducts.length} NEW PRODUCT(S) — checking liveness...`);

      const liveProducts: string[] = [];
      const stagedProducts: { id: string; imageUrl: string }[] = [];

      for (const id of newProducts) {
        const imageUrl = imageMap.get(id) || "";
        const live = await isProductLive(imageUrl);
        if (live) {
          liveProducts.push(id);
          console.log(`    ✅ https://p-bandai.com/us/item/${id} (LIVE)`);
        } else {
          stagedProducts.push({ id, imageUrl });
          console.log(`    ⏳ https://p-bandai.com/us/item/${id} (staged/404 — watching)`);
        }
      }

      // Notify about live products
      if (liveProducts.length > 0) {
        const links = liveProducts
          .map((id) => `- https://p-bandai.com/us/item/${id}`)
          .join("\n");
        await notifyDiscord(
          [
            `🚨 **${liveProducts.length} new product(s) on Premium Bandai USA!**`,
            "",
            links,
            "",
            "Check immediately — could be One Piece Card Game drop!",
          ].join("\n")
        );
      }

      // Notify about staged products (but let user know they might 404)
      if (stagedProducts.length > 0) {
        const links = stagedProducts
          .map((p) => `- https://p-bandai.com/us/item/${p.id}`)
          .join("\n");
        await notifyDiscord(
          [
            `⏳ **${stagedProducts.length} new product(s) detected but NOT YET LIVE**`,
            "(Page may 404 — will notify again when accessible)",
            "",
            links,
          ].join("\n")
        );

        // Add to watch list
        const now = new Date().toISOString();
        for (const p of stagedProducts) {
          state.watchList.push({ id: p.id, imageUrl: p.imageUrl, firstSeen: now });
        }
      }
    }

    if (removedProducts.length > 0) {
      console.log(`  🗑️  ${removedProducts.length} product(s) removed`);
    }

    if (newProducts.length === 0 && removedProducts.length === 0) {
      console.log("  Sitemap changed (metadata) but no new/removed products");
    }

    saveState({ etag: result.etag, productIds, watchList: state.watchList });
    consecutiveErrors = 0;
    return { newCount: newProducts.length };
  } catch (err) {
    consecutiveErrors++;
    console.error(`\n[${time}] Error (${consecutiveErrors}x):`, (err as Error).message);
    if (consecutiveErrors >= 5) {
      console.error("  Too many consecutive errors, backing off...");
      await new Promise((r) => setTimeout(r, 60_000));
    }
    return { newCount: 0 };
  }
}

// ── Entry point ─────────────────────────────────────────────────────
const ONCE = process.argv.includes("--once");

async function main() {
  console.log("🔍 Premium Bandai USA Product Monitor");
  console.log(`   Sitemap:  ${SITEMAP_URL}`);
  console.log(`   Mode:     ${ONCE ? "single check" : `loop (${POLL_INTERVAL_MS / 1000}s)`}`);
  console.log(
    `   Discord:  ${DISCORD_WEBHOOK_URL ? "configured ✓" : "NOT SET (set PBANDAI_DISCORD_WEBHOOK in .env)"}`
  );

  const state = loadState();
  if (state.productIds.length > 0) {
    console.log(`   Baseline: ${state.productIds.length} known products`);
  } else {
    console.log("   Baseline: none (first run will save current products)");
  }
  if (state.watchList.length > 0) {
    console.log(`   Watching: ${state.watchList.length} staged product(s)`);
  }
  console.log("");

  await poll();

  if (!ONCE) {
    setInterval(poll, POLL_INTERVAL_MS);
    console.log(`\n⏳ Monitoring... (Ctrl+C to stop)\n`);
  }
}

main();
