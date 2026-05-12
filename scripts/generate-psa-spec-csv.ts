// Generates the CSV that the freelancer fills in with PSA pop URLs.
//
// Output:  data/psa-spec-todo.csv
// Columns: card_id, name, set, market_price, tcgplayer_url, psa_pop_url, notes
//
// The freelancer only fills the psa_pop_url column. Everything else is
// reference info so they can identify the right PSA card.
//
// Usage:
//   npx tsx scripts/generate-psa-spec-csv.ts
//   npx tsx scripts/generate-psa-spec-csv.ts --limit 100
//   npx tsx scripts/generate-psa-spec-csv.ts --min-price 10
//   npx tsx scripts/generate-psa-spec-csv.ts --skip-already-mapped
//
// By default writes EVERY card in card_prices that has a tcgplayer_product_id
// and a non-null market_price, sorted by market_price DESC (most valuable
// cards first — the most likely to have PSA pop data).

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });

const OUT_PATH = path.join(process.cwd(), 'data', 'psa-spec-todo.csv');

interface CliOptions {
  limit?: number;
  minPrice?: number;
  skipAlreadyMapped: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const out: CliOptions = { skipAlreadyMapped: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limit') out.limit = Number(argv[++i]);
    else if (argv[i] === '--min-price') out.minPrice = Number(argv[++i]);
    else if (argv[i] === '--skip-already-mapped') out.skipAlreadyMapped = true;
  }
  return out;
}

// CSV-escape a field per RFC 4180.
function csvCell(value: string | number | null | undefined): string {
  if (value == null) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase env vars');
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Supabase JS defaults to a 1000-row cap on .select(). Paginate via .range
  // so we actually get the whole catalog when --limit isn't set.
  const rows: {
    card_id: string;
    tcgplayer_product_id: number | null;
    tcgplayer_product_name: string | null;
    market_price: number | null;
    psa_spec_id: number | null;
  }[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    if (opts.limit != null && rows.length >= opts.limit) break;
    const to = from + PAGE - 1;

    let query = supabase
      .from('card_prices')
      .select('card_id, tcgplayer_product_id, tcgplayer_product_name, market_price, psa_spec_id')
      .not('tcgplayer_product_id', 'is', null)
      .not('market_price', 'is', null)
      .order('market_price', { ascending: false })
      .range(from, to);

    if (opts.minPrice != null) query = query.gte('market_price', opts.minPrice);

    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }

  if (opts.limit != null) rows.length = Math.min(rows.length, opts.limit);
  if (rows.length === 0) {
    console.error('No rows returned');
    process.exit(1);
  }

  const filtered = opts.skipAlreadyMapped
    ? rows.filter(r => r.psa_spec_id == null)
    : rows;

  // Best-effort set extraction from the card_id ("OP10-065_p1" → "OP10").
  function extractSetId(cardId: string): string {
    const m = cardId.match(/^([A-Z]+\d+)/);
    return m ? m[1] : '';
  }

  const header = ['card_id', 'name', 'set', 'market_price', 'tcgplayer_url', 'psa_pop_url', 'notes'];
  const lines: string[] = [header.join(',')];

  for (const r of filtered) {
    lines.push(
      [
        csvCell(r.card_id),
        csvCell(r.tcgplayer_product_name),
        csvCell(extractSetId(r.card_id)),
        csvCell(r.market_price?.toFixed(2)),
        csvCell(`https://www.tcgplayer.com/product/${r.tcgplayer_product_id}`),
        '', // psa_pop_url — freelancer fills this
        '', // notes
      ].join(','),
    );
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, lines.join('\n') + '\n', 'utf8');

  console.log(`Wrote ${filtered.length} rows to ${OUT_PATH}`);
  if (opts.skipAlreadyMapped) {
    console.log(`  (skipped ${rows.length - filtered.length} cards that already have a psa_spec_id)`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
