// Pulls PSA population data via the PSA Public API and upserts into
// card_grade_populations. Iterates every card in card_prices that has
// a psa_spec_id set.
//
// Daily PSA API budget on the free tier is 100 calls — well under the
// ~30 calls a weekly cycle of the chase cards costs.
//
// Usage:
//   npx tsx scripts/psa-pop-fetch.ts              # all cards with psa_spec_id
//   npx tsx scripts/psa-pop-fetch.ts <card_id>    # one card only
//
// Env:  PSA_API_TOKEN (PSA Public API OAuth access token)

import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });

const PSA_API_TOKEN = process.env.PSA_API_TOKEN;
if (!PSA_API_TOKEN) {
  console.error('Missing PSA_API_TOKEN in .env.local');
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase env vars');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

interface PSAPop {
  Grade1: number; Grade1_5: number;
  Grade2: number; Grade2_5: number;
  Grade3: number; Grade3_5: number;
  Grade4: number; Grade4_5: number;
  Grade5: number; Grade5_5: number;
  Grade6: number; Grade6_5: number;
  Grade7: number; Grade7_5: number;
  Grade8: number; Grade8_5: number;
  Grade9: number;
  Grade10: number;
  Total: number;
  Auth: number;
}

interface PSASpecResponse {
  SpecID: number;
  Description: string;
  PSAPop: PSAPop;
}

// Grades to record in our DB. Below 7 is commercially irrelevant for TCG.
const RECORDED_GRADES: { dbGrade: string; popKey: keyof PSAPop }[] = [
  { dbGrade: '10', popKey: 'Grade10' },
  { dbGrade: '9', popKey: 'Grade9' },
  { dbGrade: '8.5', popKey: 'Grade8_5' },
  { dbGrade: '8', popKey: 'Grade8' },
  { dbGrade: '7', popKey: 'Grade7' },
];

async function fetchPSAPop(specId: number): Promise<PSASpecResponse | null> {
  const res = await fetch(
    `https://api.psacard.com/publicapi/pop/GetPSASpecPopulation/${specId}`,
    { headers: { Authorization: `Bearer ${PSA_API_TOKEN}` } },
  );
  if (res.status === 429) {
    console.error('Hit PSA rate limit (100/day) — bailing');
    return null;
  }
  if (!res.ok) {
    console.error(`spec ${specId}: HTTP ${res.status}`);
    return null;
  }
  return (await res.json()) as PSASpecResponse;
}

async function main() {
  const cardIdArg = process.argv[2];
  let query = supabase
    .from('card_prices')
    .select('card_id, psa_spec_id')
    .not('psa_spec_id', 'is', null);
  if (cardIdArg) query = query.eq('card_id', cardIdArg);

  const { data: targets, error } = await query;
  if (error) throw error;
  if (!targets || targets.length === 0) {
    console.log('No cards with psa_spec_id found.');
    return;
  }

  console.log(`Pulling PSA pop for ${targets.length} card(s)...`);
  const now = new Date().toISOString();
  let ok = 0;

  for (const t of targets) {
    const result = await fetchPSAPop(t.psa_spec_id);
    if (!result) continue;

    const rows = RECORDED_GRADES.map(g => ({
      card_id: t.card_id,
      company: 'PSA' as const,
      grade: g.dbGrade,
      count: Number(result.PSAPop[g.popKey] ?? 0),
      synced_at: now,
    }));

    const { error: upsertError } = await supabase
      .from('card_grade_populations')
      .upsert(rows, { onConflict: 'card_id,company,grade' });

    if (upsertError) {
      console.error(`  ${t.card_id}: upsert error: ${upsertError.message}`);
      continue;
    }
    ok++;
    const grades = rows.map(r => `${r.grade}=${r.count}`).join('  ');
    console.log(`  ${t.card_id.padEnd(20)} ${result.Description.slice(0, 40).padEnd(40)} ${grades}  total=${result.PSAPop.Total}`);
  }

  console.log(`\nDone. ${ok}/${targets.length} cards updated.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
