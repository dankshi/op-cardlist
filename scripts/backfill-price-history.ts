import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { execSync } from 'child_process';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });

const TCGCSV_ARCHIVE_URL = 'https://tcgcsv.com/archive/tcgplayer/prices-{DATE}.ppmd.7z';
const ONE_PIECE_CATEGORY = '68';

interface HistoryRow {
  tcgplayer_product_id: number;
  recorded_date: string;
  market_price: number | null;
  lowest_price: number | null;
  median_price: number | null;
  total_listings: null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function generateDateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const current = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

function parsePrice(val: string): number | null {
  if (!val || val === '' || val === 'null') return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

/** Find the 7z executable — checks common Windows install paths and PATH */
function find7z(): string {
  try {
    execSync('7z --help', { stdio: 'pipe' });
    return '7z';
  } catch {}

  const windowsPaths = [
    'C:\\Program Files\\7-Zip\\7z.exe',
    'C:\\Program Files (x86)\\7-Zip\\7z.exe',
  ];
  for (const p of windowsPaths) {
    if (fs.existsSync(p)) return `"${p}"`;
  }

  throw new Error('7z not found. Install 7-Zip and ensure it is in PATH or at C:\\Program Files\\7-Zip\\');
}

async function processDate(
  date: string,
  supabase: ReturnType<typeof createClient>,
  tmpDir: string,
  sevenZip: string,
  debug: boolean
): Promise<number> {
  const archiveUrl = TCGCSV_ARCHIVE_URL.replace('{DATE}', date);
  const archivePath = path.join(tmpDir, `prices-${date}.ppmd.7z`);
  const extractDir = path.join(tmpDir, `extract-${date}`);

  try {
    // Download the archive
    const response = await fetch(archiveUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(archivePath, buffer);

    // Extract
    fs.mkdirSync(extractDir, { recursive: true });
    execSync(`${sevenZip} x "${archivePath}" -o"${extractDir}" -y`, { stdio: 'pipe' });

    // Find the category 68 directory (One Piece)
    // Archive structure varies: {date}/68/{groupId}/prices  OR  68/{groupId}/prices
    let categoryDir = path.join(extractDir, date, ONE_PIECE_CATEGORY);
    if (!fs.existsSync(categoryDir)) {
      categoryDir = path.join(extractDir, ONE_PIECE_CATEGORY);
    }
    if (!fs.existsSync(categoryDir)) {
      const allDirs = fs.readdirSync(extractDir, { recursive: true, withFileTypes: true });
      const found = allDirs.find(d => d.isDirectory() && d.name === ONE_PIECE_CATEGORY);
      if (found) {
        categoryDir = path.join(found.parentPath || found.path, found.name);
      }
    }
    if (!fs.existsSync(categoryDir)) {
      if (debug) console.log(`  No category 68 dir found for ${date}`);
      return 0;
    }

    // Parse each group's prices file
    // No card_id mapping needed — we store by tcgplayer_product_id directly
    const historyRows: HistoryRow[] = [];

    const groupDirs = fs.readdirSync(categoryDir);
    for (const groupId of groupDirs) {
      const pricesFile = path.join(categoryDir, groupId, 'prices');
      if (!fs.existsSync(pricesFile)) continue;

      const content = fs.readFileSync(pricesFile, 'utf-8');
      const lines = content.trim().split('\n');
      if (lines.length < 2) continue;

      // Header: productId,subTypeName,lowPrice,midPrice,highPrice,marketPrice,directLowPrice
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        if (cols.length < 6) continue;

        const productId = parseInt(cols[0]);
        if (isNaN(productId)) continue;

        const subTypeName = cols[1]?.replace(/"/g, '').trim();

        // Only "Normal" subtype (skip Foil)
        if (subTypeName !== 'Normal') continue;

        historyRows.push({
          tcgplayer_product_id: productId,
          recorded_date: date,
          market_price: parsePrice(cols[5]),  // marketPrice
          lowest_price: parsePrice(cols[2]),  // lowPrice
          median_price: parsePrice(cols[3]),  // midPrice
          total_listings: null,
        });
      }
    }

    // Batch upsert to Supabase
    let inserted = 0;
    const BATCH_SIZE = 500;
    for (let i = 0; i < historyRows.length; i += BATCH_SIZE) {
      const batch = historyRows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from('card_price_history')
        .upsert(batch, { onConflict: 'tcgplayer_product_id,recorded_date', ignoreDuplicates: false });

      if (error) {
        console.error(`\n  Upsert error for ${date}: ${error.message}`);
      } else {
        inserted += batch.length;
      }
    }

    return inserted;
  } finally {
    if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });
    if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const fromDate = args.find(a => a.startsWith('--from='))?.split('=')[1] || '2024-02-08';
  const toDate = args.find(a => a.startsWith('--to='))?.split('=')[1] || new Date().toISOString().split('T')[0];
  const debug = args.includes('--debug');

  console.log('Price History Backfill from TCGCSV Archives');
  console.log(`  Range: ${fromDate} to ${toDate}`);
  console.log('  Keyed by tcgplayer_product_id (all One Piece products, category 68)');

  // Validate 7z
  const sevenZip = find7z();
  console.log(`  7z: ${sevenZip}`);

  // Connect to Supabase
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local');
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Generate date range
  const dates = generateDateRange(fromDate, toDate);
  console.log(`  Dates to process: ${dates.length}\n`);

  const tmpDir = path.join(process.cwd(), 'tmp', 'price-backfill');
  fs.mkdirSync(tmpDir, { recursive: true });

  let totalInserted = 0;
  let totalFailed = 0;
  const startTime = Date.now();

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const elapsed = Date.now() - startTime;
    const rate = i > 0 ? elapsed / i : 0;
    const remaining = (dates.length - i) * rate;
    const eta = i > 3 ? formatTime(remaining) : '--';

    process.stdout.write(`[${i + 1}/${dates.length}] ${date} (ETA: ${eta}) ... `);

    try {
      const inserted = await processDate(date, supabase, tmpDir, sevenZip, debug);
      console.log(`${inserted} rows`);
      totalInserted += inserted;
    } catch (error: any) {
      console.log(`FAILED: ${error.message}`);
      totalFailed++;
    }

    // Rate limit - don't hammer TCGCSV
    await sleep(1000);
  }

  // Cleanup tmp dir
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log(`\nDone in ${formatTime(Date.now() - startTime)}`);
  console.log(`  Total rows inserted: ${totalInserted}`);
  console.log(`  Failed dates: ${totalFailed}/${dates.length}`);
}

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

main().catch(console.error);
