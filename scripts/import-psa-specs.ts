// Reads the filled CSV back from the freelancer and updates
// card_prices.psa_spec_id for every row that has a parseable PSA pop URL.
//
// Usage:
//   npx tsx scripts/import-psa-specs.ts
//   npx tsx scripts/import-psa-specs.ts --csv data/psa-spec-filled.csv
//   npx tsx scripts/import-psa-specs.ts --dry-run
//
// Default input: data/psa-spec-filled.csv

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });

const DEFAULT_CSV = path.join(process.cwd(), 'data', 'psa-spec-filled.csv');

// Extract the trailing numeric segment from a PSA pop URL.
//   https://www.psacard.com/pop/tcg-cards/2024/one-piece-tcg/sugar-sp/15173631
//                                                                     ^^^^^^^^
//   https://www.psacard.com/pop/tcg-cards/2024/one-piece-tcg/sugar-sp/15173631/
//   https://www.psacard.com/pop/.../15173631?ref=foo
// Returns null if no spec id found.
function parseSpecIdFromUrl(url: string): number | null {
  if (!url) return null;
  const m = url.match(/\/(\d{6,})(?:[/?#]|$)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

// Tiny RFC-4180-ish CSV parser. Handles quoted fields and escaped quotes.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cell = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') {
        row.push(cell);
        cell = '';
      } else if (c === '\n' || c === '\r') {
        if (cell !== '' || row.length > 0) {
          row.push(cell);
          rows.push(row);
        }
        cell = '';
        row = [];
        if (c === '\r' && text[i + 1] === '\n') i++;
      } else {
        cell += c;
      }
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

async function main() {
  const args = process.argv.slice(2);
  let csvPath = DEFAULT_CSV;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--csv') csvPath = args[++i];
    else if (args[i] === '--dry-run') dryRun = true;
  }

  if (!fs.existsSync(csvPath)) {
    console.error(`CSV not found: ${csvPath}`);
    process.exit(1);
  }

  const text = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCsv(text);
  if (rows.length < 2) {
    console.error('CSV has no data rows');
    process.exit(1);
  }

  const header = rows[0].map(h => h.trim().toLowerCase());
  const cardIdIdx = header.indexOf('card_id');
  const urlIdx = header.indexOf('psa_pop_url');
  const notesIdx = header.indexOf('notes');
  if (cardIdIdx < 0 || urlIdx < 0) {
    console.error('CSV must have "card_id" and "psa_pop_url" header columns');
    process.exit(1);
  }

  let imported = 0;
  let blank = 0;
  let parseFailed = 0;
  const updates: { card_id: string; psa_spec_id: number }[] = [];
  const parseErrors: { row: number; card_id: string; url: string; note: string }[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const cardId = (row[cardIdIdx] ?? '').trim();
    const url = (row[urlIdx] ?? '').trim();
    const note = notesIdx >= 0 ? (row[notesIdx] ?? '').trim() : '';
    if (!cardId) continue;
    if (!url) {
      blank++;
      continue;
    }
    const specId = parseSpecIdFromUrl(url);
    if (specId == null) {
      parseFailed++;
      parseErrors.push({ row: r + 1, card_id: cardId, url, note });
      continue;
    }
    updates.push({ card_id: cardId, psa_spec_id: specId });
  }

  console.log(`Parsed ${updates.length} mappings, ${blank} blank rows, ${parseFailed} unparseable.`);
  if (parseErrors.length > 0) {
    console.log('\nUnparseable rows:');
    for (const e of parseErrors.slice(0, 20)) {
      console.log(`  row ${e.row}  ${e.card_id}  url=${JSON.stringify(e.url)}${e.note ? `  note=${e.note}` : ''}`);
    }
    if (parseErrors.length > 20) console.log(`  ...and ${parseErrors.length - 20} more`);
  }

  if (dryRun) {
    console.log('\n(dry run — no DB writes)');
    return;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase env vars');
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Update in parallel (~50 at a time so we don't hammer the connection pool).
  const CHUNK = 50;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const chunk = updates.slice(i, i + CHUNK);
    const results = await Promise.all(
      chunk.map(u =>
        supabase.from('card_prices').update({ psa_spec_id: u.psa_spec_id }).eq('card_id', u.card_id),
      ),
    );
    const failures = results.filter(r => r.error);
    imported += chunk.length - failures.length;
    if (failures.length > 0) {
      console.error(`  ${failures.length} update failures in chunk ${i}-${i + chunk.length}: ${failures[0].error?.message}`);
    }
  }

  console.log(`\nImported ${imported} psa_spec_id mappings.`);
  console.log(`Next: npx tsx scripts/psa-pop-fetch.ts  (uses PSA API budget ~ ${imported} calls)`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
