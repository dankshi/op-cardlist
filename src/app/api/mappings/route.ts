import { NextResponse } from 'next/server';
import { supabase, type MappingSubmission } from '@/lib/supabase';
import { createClient as createServerSupabase } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

// Known TCGplayer variant suffixes. When parsing a URL slug like
// "Three Thousand Worlds Alternate Art", we want to recover the standard
// "(Alternate Art)" parenthesized form so the downstream art_style
// derivation can detect markers. Longer phrases first so "Super Alternate
// Art" gets wrapped before "Alternate Art" runs and chops it.
const VARIANT_SUFFIXES = [
  'Super Alternate Art',
  'Red Super Alternate Art',
  'Alternate Art',
  'Wanted Poster',
  'Jolly Roger Foil',
  'Textured Foil',
  'Pirate Foil',
  'Full Art',
  'Reprint',
  'Manga',
  'Parallel',
  'Gold',
  'SP',
  'TR',
];

function markVariantSuffixes(name: string): string {
  let result = name;
  for (const suffix of VARIANT_SUFFIXES) {
    // Match the suffix at end-of-string, optionally already in parens.
    const re = new RegExp(`(?:\\s*\\()?\\s*${suffix.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*\\)?\\s*$`, 'i');
    if (re.test(result)) {
      result = result.replace(re, '').trim() + ` (${suffix})`;
      break; // one suffix is enough — most products have only one
    }
  }
  return result;
}

// GET /api/mappings - Get all mappings (approved only for public, all for admin)
export async function GET(request: Request) {
  try {
    if (!supabase) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const { searchParams } = new URL(request.url);
    const includeUnapproved = searchParams.get('all') === 'true';
    const adminKey = request.headers.get('x-admin-key');

    // Check if admin key matches (for viewing unapproved)
    const isAdmin = adminKey === process.env.ADMIN_KEY;

    let query = supabase.from('card_mappings_legacy').select('*');

    // Only show approved unless admin requests all
    if (!isAdmin || !includeUnapproved) {
      query = query.eq('approved', true);
    }

    const { data, error } = await query.order('updated_at', { ascending: false });

    if (error) {
      console.error('Supabase error:', error);
      return NextResponse.json({ error: 'Failed to fetch mappings' }, { status: 500 });
    }

    // Convert to our format
    const mappings: Record<string, {
      tcgProductId: number;
      tcgUrl: string;
      tcgName: string;
      price: number | null;
      artStyle: string | null;
      approved: boolean;
    }> = {};

    data?.forEach(row => {
      mappings[row.card_id] = {
        tcgProductId: row.tcgplayer_product_id,
        tcgUrl: row.tcgplayer_url,
        tcgName: row.tcgplayer_name,
        price: row.market_price,
        artStyle: row.art_style,
        approved: row.approved,
      };
    });

    return NextResponse.json({ mappings, count: data?.length || 0 });
  } catch (error) {
    console.error('Error fetching mappings:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/mappings - Submit new mapping(s)
// Writes to both card_mappings (audit trail) and card_prices (source of truth)
export async function POST(request: Request) {
  try {
    if (!supabase) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const body = await request.json();
    const submissions: MappingSubmission[] = Array.isArray(body) ? body : [body];

    if (submissions.length === 0) {
      return NextResponse.json({ error: 'No mappings provided' }, { status: 400 });
    }

    // Backfill tcgName/tcgUrl when the client only sent a product_id (the
    // URL-pasted path). Lookup order:
    //   1. Our cached tcgplayer_products row (authoritative when present)
    //   2. URL slug parsed from the user-supplied URL — gives a name like
    //      "Three Thousand Worlds (Alternate Art)" so the art_style
    //      derivation step downstream can detect variant markers even for
    //      products we haven't ingested into tcgplayer_products yet.
    //   3. Fall back to "product {id}" as a last resort.
    for (const sub of submissions) {
      const { data: prod } = await supabase
        .from('tcgplayer_products')
        .select('product_name, product_url_name')
        .eq('product_id', sub.tcgProductId)
        .maybeSingle();
      if (prod) {
        sub.tcgName = sub.tcgName || prod.product_name || `product ${sub.tcgProductId}`;
        // Always rebuild the canonical URL from the cached slug — the
        // user's pasted URL often has tracking params or different casing.
        sub.tcgUrl = prod.product_url_name
          ? `https://www.tcgplayer.com/product/${sub.tcgProductId}/${prod.product_url_name}`
          : `https://www.tcgplayer.com/product/${sub.tcgProductId}`;
      } else {
        // Parse name from the URL slug: /product/<id>/<slug>?...
        // The slug is the seo-friendly form of the product name with
        // hyphens or %20 between words. Strip query string, decode, then
        // wrap variant suffixes in parens so the art_style derivation
        // step below can pick them up.
        const slugMatch = sub.tcgUrl?.match(/\/product\/\d+\/([^?#]+)/);
        if (slugMatch) {
          const decoded = decodeURIComponent(slugMatch[1]).replace(/[-_]+/g, ' ').trim();
          sub.tcgName = sub.tcgName || markVariantSuffixes(decoded);
        } else {
          sub.tcgName = sub.tcgName || `product ${sub.tcgProductId}`;
        }
        sub.tcgUrl = sub.tcgUrl || `https://www.tcgplayer.com/product/${sub.tcgProductId}`;
      }
    }

    // Resolve the acting admin from the auth cookie so audit columns
    // (submitted_by / mapped_by) record who actually clicked Assign.
    // Falls back to body.submittedBy or 'anonymous' if there's no
    // authenticated user (e.g. the legacy /test page POSTing before).
    const serverSupabase = await createServerSupabase();
    const { data: { user } } = await serverSupabase.auth.getUser();
    let submittedBy = body.submittedBy || 'anonymous';
    if (user) {
      const { data: profile } = await serverSupabase
        .from('profiles')
        .select('display_name, username, is_admin')
        .eq('id', user.id)
        .single();
      if (profile?.is_admin) {
        submittedBy = profile.display_name || profile.username || user.email || user.id;
      } else if (profile) {
        // Authenticated but not admin — reject; only admins should be
        // changing TCGplayer mappings.
        return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
      }
    }

    // 1. Save to card_mappings (audit trail)
    const mappingRows = submissions.map(sub => ({
      card_id: sub.cardId,
      tcgplayer_product_id: sub.tcgProductId,
      tcgplayer_url: sub.tcgUrl,
      tcgplayer_name: sub.tcgName,
      market_price: sub.price ?? null,
      art_style: sub.artStyle ?? null,
      submitted_by: submittedBy,
      approved: true,
    }));

    const { data, error } = await supabase
      .from('card_mappings_legacy')
      .upsert(mappingRows, { onConflict: 'card_id' })
      .select();

    if (error) {
      console.error('Supabase error (card_mappings):', error);
      return NextResponse.json({ error: 'Failed to save mappings', details: error.message }, { status: 500 });
    }

    // 2. Save to card_tcgplayer_mapping (source of truth for card_id ↔
    //    tcgplayer_product_id). Marked source='manual' since this came
    //    from a human via the /test page.
    const tcgMappingRows = submissions.map(sub => ({
      card_id: sub.cardId,
      tcgplayer_product_id: sub.tcgProductId,
      tcgplayer_url: sub.tcgUrl,
      tcgplayer_name: sub.tcgName,
      source: 'manual' as const,
      mapped_by: submittedBy,
    }));

    const { error: mappingError } = await supabase
      .from('card_tcgplayer_mapping')
      .upsert(tcgMappingRows, { onConflict: 'card_id' });

    if (mappingError) {
      console.error('Supabase error (card_tcgplayer_mapping):', mappingError);
      // Don't fail — card_mappings (legacy audit) already saved
    }

    // 3. Stub a row in tcgplayer_card_prices with the submitted price so
    //    the card has a price row before the next scrape runs. Mapping
    //    cols moved to card_tcgplayer_mapping (written above); only the
    //    price columns live here now.
    const priceRows = submissions.map(sub => ({
      card_id: sub.cardId,
      market_price: sub.price ?? null,
    }));

    const { error: priceError } = await supabase
      .from('tcgplayer_card_prices')
      .upsert(priceRows, { onConflict: 'card_id' });

    if (priceError) {
      console.error('Supabase error (tcgplayer_card_prices):', priceError);
      // Don't fail — card_tcgplayer_mapping already saved
    }

    // 4. Derive cards.art_style from the mapped product name. Mirrors the
    //    post-mapping correction step in scripts/auto-map-tcgplayer.ts so a
    //    manual assignment immediately reflects the right art_style (e.g.
    //    assigning a JRF/Pirate Foil/Reprint product flips a card to
    //    'standard', which the isHiddenCard filter then drops from
    //    /admin/mappings and the public site).
    for (const sub of submissions) {
      const name = (sub.tcgName ?? '').toLowerCase();
      let derived: string | null = null;
      if (name.includes('(pirate foil)') || name.includes('(jolly roger foil)') || name.includes('(reprint)')) derived = 'standard';
      else if (name.includes('(manga)')) derived = 'manga';
      else if (name.includes('(wanted poster)')) derived = 'wanted';
      else if (name.includes('(textured foil)')) derived = 'textured';
      else if (name.includes('(parallel)') || name.includes('(alternate art)')) derived = 'alternate';
      if (!derived) continue;
      // cards table is SELECT-only for anon — use service role for writes.
      const admin = getSupabaseAdmin();
      const { error: artError } = await admin.from('cards').update({ art_style: derived }).eq('id', sub.cardId);
      if (artError) console.error(`Failed to update art_style for ${sub.cardId}:`, artError.message);
    }

    return NextResponse.json({
      success: true,
      saved: data?.length || 0,
      approved: true,
      message: `Saved and approved ${data?.length} mapping(s)`
    });
  } catch (error) {
    console.error('Error saving mappings:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
