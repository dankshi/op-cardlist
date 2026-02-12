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
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return { etag: "", productIds: [] };
  }
}

function saveState(state: State) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ── Sitemap fetching ────────────────────────────────────────────────
async function checkSitemap(
  lastEtag: string
): Promise<{ changed: boolean; etag: string; productIds: string[] }> {
  // Conditional request — if ETag hasn't changed, server returns 304 (no body)
  const res = await fetch(SITEMAP_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      ...(lastEtag ? { "If-None-Match": lastEtag } : {}),
    },
  });

  const etag = res.headers.get("etag") || "";

  if (res.status === 304) {
    return { changed: false, etag: lastEtag, productIds: [] };
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const xml = await res.text();
  // Extract all product IDs from the sitemap
  const matches = xml.matchAll(/\/item\/([A-Z0-9]+)/g);
  const productIds = [...matches].map((m) => m[1]);

  return { changed: true, etag, productIds };
}

// ── Discord notification ────────────────────────────────────────────
async function notifyDiscord(newProductIds: string[]) {
  if (!DISCORD_WEBHOOK_URL) {
    console.log(
      "  (Discord not configured — set PBANDAI_DISCORD_WEBHOOK in .env)"
    );
    return;
  }

  const links = newProductIds
    .map((id) => `- https://p-bandai.com/us/item/${id}`)
    .join("\n");

  const res = await fetch(DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: [
        `🚨 **${newProductIds.length} new product(s) on Premium Bandai USA!**`,
        "",
        links,
        "",
        "Check immediately — could be One Piece Card Game drop!",
      ].join("\n"),
    }),
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
    const result = await checkSitemap(state.etag);

    if (!result.changed) {
      process.stdout.write(`\r[${time}] No changes (304)          `);
      consecutiveErrors = 0;
      return { newCount: 0 };
    }

    console.log(`\n[${time}] Sitemap updated! ${result.productIds.length} products`);

    if (state.productIds.length === 0) {
      // First run — save baseline
      console.log(`  First run — saving ${result.productIds.length} products as baseline`);
      saveState({ etag: result.etag, productIds: result.productIds });
      consecutiveErrors = 0;
      return { newCount: 0 };
    }

    // Find new products
    const oldSet = new Set(state.productIds);
    const newProducts = result.productIds.filter((id) => !oldSet.has(id));

    // Find removed products
    const newSet = new Set(result.productIds);
    const removedProducts = state.productIds.filter((id) => !newSet.has(id));

    if (newProducts.length > 0) {
      console.log(`  🆕 ${newProducts.length} NEW PRODUCT(S):`);
      for (const id of newProducts) {
        console.log(`    → https://p-bandai.com/us/item/${id}`);
      }
      await notifyDiscord(newProducts);
    }

    if (removedProducts.length > 0) {
      console.log(`  🗑️  ${removedProducts.length} product(s) removed`);
    }

    if (newProducts.length === 0 && removedProducts.length === 0) {
      console.log("  Sitemap changed (metadata) but no new/removed products");
    }

    saveState({ etag: result.etag, productIds: result.productIds });
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
  console.log("");

  // Run once (for CI) or loop (for local)
  await poll();

  if (!ONCE) {
    setInterval(poll, POLL_INTERVAL_MS);
    console.log(`\n⏳ Monitoring... (Ctrl+C to stop)\n`);
  }
}

main();
