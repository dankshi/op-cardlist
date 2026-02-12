import * as fs from "fs";
import * as path from "path";
import "dotenv/config";

// ── Config ──────────────────────────────────────────────────────────
const SITEMAP_URL = "https://p-bandai.com/us/sitemap-product_1.xml";
const STATE_FILE = path.join(__dirname, "..", "data", "pbandai-state.json");
const POLL_INTERVAL_MS = 30_000; // 30 seconds
const DISCORD_WEBHOOK_URL = process.env.PBANDAI_DISCORD_WEBHOOK;

interface State {
  etag: string;
  productIds: string[];
}

// ── State management ────────────────────────────────────────────────
function loadState(): State {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    return { etag: data.etag || "", productIds: data.productIds || [] };
  } catch {
    return { etag: "", productIds: [] };
  }
}

function saveState(state: State) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
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

  // Parse each <url> entry
  const products: SitemapProduct[] = [];
  const entries = xml.matchAll(/<url>([\s\S]*?)<\/url>/g);
  for (const entry of entries) {
    const block = entry[1];
    const idMatch = block.match(/\/item\/([A-Z0-9]+)/);
    if (!idMatch) continue;

    const imgMatch = block.match(/<image:loc>([^<]+)<\/image:loc>/);
    products.push({
      id: idMatch[1],
      imageUrl: imgMatch ? imgMatch[1] : "",
    });
  }

  return { changed: true, etag, products };
}

// ── Discord notification ────────────────────────────────────────────
async function notifyDiscord(products: SitemapProduct[]) {
  if (!DISCORD_WEBHOOK_URL) {
    console.log("  (Discord not configured — set PBANDAI_DISCORD_WEBHOOK in .env)");
    return;
  }

  // Send with embeds that include product thumbnails
  const embeds = products.map((p) => ({
    title: `New product: ${p.id}`,
    url: `https://p-bandai.com/us/item/${p.id}`,
    color: 0xff0000,
    ...(p.imageUrl ? { thumbnail: { url: p.imageUrl } } : {}),
    timestamp: new Date().toISOString(),
  }));

  // Discord allows max 10 embeds per message
  for (let i = 0; i < embeds.length; i += 10) {
    const batch = embeds.slice(i, i + 10);
    const res = await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `🚨 **${batch.length} new product(s) on Premium Bandai USA!**\nCould be One Piece Card Game — check the images below:`,
        embeds: batch,
      }),
    });

    if (!res.ok) {
      console.error(`  Discord webhook failed: ${res.status}`);
    } else {
      console.log("  Discord notification sent!");
    }
  }
}

// ── Single poll ─────────────────────────────────────────────────────
let consecutiveErrors = 0;

async function poll(): Promise<{ newCount: number }> {
  const state = loadState();
  const time = new Date().toLocaleTimeString();

  try {
    const result = await checkSitemap(state.etag);

    if (!result.changed) {
      process.stdout.write(`\r[${time}] No changes (304)          `);
      consecutiveErrors = 0;
      return { newCount: 0 };
    }

    const productIds = result.products.map((p) => p.id);
    console.log(`\n[${time}] Sitemap updated! ${productIds.length} products`);

    if (state.productIds.length === 0) {
      console.log(`  First run — saving ${productIds.length} products as baseline`);
      saveState({ etag: result.etag, productIds });
      consecutiveErrors = 0;
      return { newCount: 0 };
    }

    // Find new products
    const oldSet = new Set(state.productIds);
    const newProducts = result.products.filter((p) => !oldSet.has(p.id));

    // Find removed products
    const newSet = new Set(productIds);
    const removedProducts = state.productIds.filter((id) => !newSet.has(id));

    if (newProducts.length > 0) {
      console.log(`  🆕 ${newProducts.length} NEW PRODUCT(S):`);
      for (const p of newProducts) {
        console.log(`    → https://p-bandai.com/us/item/${p.id}`);
      }
      await notifyDiscord(newProducts);
    }

    if (removedProducts.length > 0) {
      console.log(`  🗑️  ${removedProducts.length} product(s) removed`);
    }

    if (newProducts.length === 0 && removedProducts.length === 0) {
      console.log("  Sitemap changed (metadata) but no new/removed products");
    }

    saveState({ etag: result.etag, productIds });
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
  console.log("🔍 Premium Bandai USA Monitor");
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
  console.log("");

  await poll();

  if (!ONCE) {
    setInterval(poll, POLL_INTERVAL_MS);
    console.log(`\n⏳ Monitoring... (Ctrl+C to stop)\n`);
  }
}

main();
