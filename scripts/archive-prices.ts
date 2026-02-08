/**
 * Archive daily price snapshot for price history tracking.
 * Creates a dated snapshot file in data/price-history/
 */

import * as fs from 'fs';
import * as path from 'path';

interface PriceData {
  lastUpdated: string;
  prices: Record<string, { marketPrice: number | null }>;
}

interface DailySnapshot {
  date: string;
  cardCount: number;
  prices: Record<string, number | null>;
}

async function main() {
  const dataDir = path.join(process.cwd(), 'data');
  const pricesPath = path.join(dataDir, 'prices.json');
  const historyDir = path.join(dataDir, 'price-history');

  if (!fs.existsSync(pricesPath)) {
    console.error('prices.json not found. Run the price scraper first.');
    process.exit(1);
  }

  // Create history directory if needed
  if (!fs.existsSync(historyDir)) {
    fs.mkdirSync(historyDir, { recursive: true });
  }

  const priceData: PriceData = JSON.parse(fs.readFileSync(pricesPath, 'utf-8'));

  // Get today's date in YYYY-MM-DD format
  const today = new Date().toISOString().split('T')[0];
  const snapshotPath = path.join(historyDir, `${today}.json`);

  // Create snapshot with just market prices (to save space)
  const snapshot: DailySnapshot = {
    date: today,
    cardCount: Object.keys(priceData.prices).length,
    prices: {},
  };

  for (const [cardId, price] of Object.entries(priceData.prices)) {
    snapshot.prices[cardId] = price.marketPrice;
  }

  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));

  console.log(`Archived ${snapshot.cardCount} prices to ${snapshotPath}`);

  // Clean up old snapshots (keep last 365 days)
  const files = fs.readdirSync(historyDir).filter(f => f.endsWith('.json'));
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 365);
  const cutoffStr = cutoffDate.toISOString().split('T')[0];

  let deleted = 0;
  for (const file of files) {
    const fileDate = file.replace('.json', '');
    if (fileDate < cutoffStr) {
      fs.unlinkSync(path.join(historyDir, file));
      deleted++;
    }
  }

  if (deleted > 0) {
    console.log(`Cleaned up ${deleted} old snapshot(s)`);
  }
}

main().catch(console.error);
