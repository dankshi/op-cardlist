import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { getCardById, getParallelCards, isHiddenCard } from "@/lib/cards";
import { getCardSales, getCardGradedSales, getCardPopulations, getCardPsaInfo, calculatePriceChange } from "@/lib/price-history";
import { createClient } from "@/lib/supabase/server";
import { SITE_URL, SITE_NAME, getCardKeywords, getBreadcrumbSchema } from "@/lib/seo";
import { Card3DPreview } from "@/components/card/Card3DPreview";
import { InlineCardFieldEdit, ART_STYLE_OPTIONS, RARITY_OPTIONS } from "@/components/card/InlineCardFieldEdit";
import { ManualUrlAssign } from "@/components/admin/ManualUrlAssign";
import { AdminDebugSection } from "@/components/admin/AdminDebugSection";
import { CardThumbnail } from "@/components/card/CardThumbnail";
import { RecentSales } from "@/components/card/RecentSales";
import { PriceChangeBadge } from "@/components/PriceChangeBadge";
import { ShareButtons } from "@/components/ShareButtons";
import { type VariantData } from "@/components/card/CardBuyPanel";
import { CardMainPanel } from "@/components/card/CardMainPanel";
import { TrustBadges } from "@/components/card/TrustBadges";
import type { PopulationBucket, GradeCompany } from "@/lib/price-history";

// Ordering for the variant chip row: Raw first, then by grading company,
// then by grade descending within each company.
const COMPANY_ORDER: Record<string, number> = { PSA: 0, BGS: 1, CGC: 2, TAG: 3 };

/** Only show grade variants worth buying or offering on. Numeric ≥ 9, plus
 *  the prestige top-of-line labels each company uses (BGS Black Label 10,
 *  CGC Pristine 10, etc.). Lower-than-9 grades are noise in this UI. */
function isHighGrade(grade: string): boolean {
  const n = parseFloat(grade);
  if (!Number.isNaN(n)) return n >= 9;
  return /^(black label|pristine|gem mint|perfect)/i.test(grade);
}

function gradeRank(grade: string): number {
  // Top-of-line labels rank above plain 10 so "Black Label 10" leads PSA 10.
  if (/^(black label|pristine)/i.test(grade)) return 110;
  const n = parseFloat(grade);
  return Number.isNaN(n) ? 0 : n * 10;
}

function buildVariants(
  listings: Array<{ id: string; price: number; grading_company: string | null; grade: string | null }>,
  populations: Partial<Record<GradeCompany, PopulationBucket[]>>,
): VariantData[] {
  // Group listings by variant key. Listings already arrive price-ascending
  // so listings[0] for any key is its cheapest.
  const listingsByKey = new Map<string, { id: string; price: number }[]>();
  for (const l of listings) {
    const key = l.grading_company && l.grade ? `${l.grading_company}-${l.grade}` : 'raw';
    const arr = listingsByKey.get(key) ?? [];
    arr.push({ id: l.id, price: Number(l.price) });
    listingsByKey.set(key, arr);
  }

  // Build pop map, filtered to high grades only.
  const popsByKey = new Map<string, number>();
  for (const [company, buckets] of Object.entries(populations)) {
    for (const b of buckets) {
      if (!isHighGrade(b.grade)) continue;
      popsByKey.set(`${company}-${b.grade}`, b.count);
    }
  }

  // Union of all known variant keys. Always include 'raw' so it leads the
  // chip row even when nobody's listed a raw copy.
  const keys = new Set<string>(['raw', ...listingsByKey.keys(), ...popsByKey.keys()]);

  const variants: VariantData[] = [];
  for (const key of keys) {
    let company: string | null = null;
    let grade: string | null = null;
    if (key !== 'raw') {
      const dashIdx = key.indexOf('-');
      company = key.slice(0, dashIdx);
      grade = key.slice(dashIdx + 1);
      // Skip listings whose grade falls outside the high-grade window —
      // they shouldn't surface as chips even if inventory exists. (Edge
      // case: someone listed a PSA 7. Move on.)
      if (!isHighGrade(grade)) continue;
    }
    const variantListings = listingsByKey.get(key) ?? [];
    variants.push({
      key,
      label: company && grade ? `${company} ${grade}` : 'Raw',
      company,
      grade,
      population: popsByKey.get(key) ?? 0,
      lowestListingId: variantListings[0]?.id ?? null,
      lowestListingPrice: variantListings[0]?.price ?? null,
      listingCount: variantListings.length,
    });
  }

  variants.sort((a, b) => {
    if (a.key === 'raw') return -1;
    if (b.key === 'raw') return 1;
    const aCompanyIdx = COMPANY_ORDER[a.company ?? ''] ?? 99;
    const bCompanyIdx = COMPANY_ORDER[b.company ?? ''] ?? 99;
    if (aCompanyIdx !== bCompanyIdx) return aCompanyIdx - bCompanyIdx;
    return gradeRank(b.grade ?? '') - gradeRank(a.grade ?? '');
  });

  return variants;
}
import { RecordView } from "@/components/home/RecentlyViewed";
import { bandaiCardUrl } from "@/lib/bandai-sets";

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ cardId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { cardId } = await params;
  const card = await getCardById(cardId.toUpperCase());

  if (!card) {
    return {
      title: "Card Not Found",
    };
  }

  const setUpper = card.setId.toUpperCase();
  const pageUrl = `${SITE_URL}/card/${card.id.toLowerCase()}`;

  const price = card.price?.marketPrice;
  const priceText = price != null
    ? price >= 1000
      ? `$${(price / 1000).toFixed(1)}k`
      : `$${price.toFixed(2)}`
    : null;

  const stats = [
    card.type,
    card.power ? `${card.power} Power` : null,
    card.cost != null ? `Cost ${card.cost}` : null,
    card.counter ? `+${card.counter} Counter` : null,
  ].filter(Boolean).join(' | ');

  const pricePrefix = priceText ? `${priceText} - ` : '';
  const effectSnippet = card.effect ? card.effect.slice(0, 150) : '';
  const description = `${pricePrefix}${card.name} (${card.id}) - One Piece TCG ${setUpper} ${card.type} card. ${stats}. ${effectSnippet}`;

  const ogImageUrl = `${SITE_URL}/api/og/${card.id.toLowerCase()}`;

  return {
    title: `${card.name} (${card.id}) - ${setUpper} | One Piece TCG`,
    description,
    keywords: getCardKeywords(card.name, card.id, card.setId),
    openGraph: {
      title: priceText ? `${card.name} - ${priceText}` : `${card.name} - ${card.id}`,
      description: `${stats}. ${card.effect.slice(0, 150)}`,
      url: pageUrl,
      siteName: SITE_NAME,
      type: "website",
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 630,
          alt: `${card.name} - ${card.id} One Piece TCG Card`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: priceText ? `${card.name} - ${priceText}` : `${card.name} (${card.id})`,
      description: priceText ? `Currently at ${priceText}! ${stats}` : stats,
      images: [ogImageUrl],
    },
    alternates: {
      canonical: pageUrl,
    },
  };
}


export default async function CardPage({ params }: PageProps) {
  const { cardId } = await params;
  const card = await getCardById(cardId.toUpperCase());

  if (!card) {
    notFound();
  }

  const supabase = await createClient();
  const [sales, gradedSales, populations, psaInfo, priceChange, listingAgg, bidsAgg, userRes] = await Promise.all([
    getCardSales(card.id, 90),
    getCardGradedSales(card.id, 90),
    getCardPopulations(card.id),
    getCardPsaInfo(card.id),
    calculatePriceChange(card.id, card.price?.marketPrice ?? null, 7),
    // All active listings — used both for the variant chips (raw + each
    // graded company×grade) and for the inline market-data drawer's Asks
    // tab (with seller info). One fetch serves both. Asc by price so the
    // first match per variant is the cheapest.
    supabase
      .from("listings")
      .select("id, price, condition, grading_company, grade, quantity_available, created_at, seller:profiles!listings_seller_id_fkey(display_name, username)")
      .eq("card_id", card.id)
      .eq("status", "active")
      .order("price", { ascending: true }),
    // Bids for the inline market-data drawer. We render the placement
    // form via BidAskSpread (which fetches its own data client-side), but
    // also pass a count up to the tab badge.
    supabase
      .from('bids')
      .select('id, price, grading_company, grade, created_at, user_id, buyer:profiles!bids_user_id_fkey(display_name, username)')
      .eq('card_id', card.id)
      .eq('status', 'active')
      .order('price', { ascending: false }),
    // Auth context — drives the admin-only debug panel below. Non-admins
    // never receive the debug HTML at all (server-side gate); admins get
    // it but can hide it via the toggle in the profile dropdown.
    supabase.auth.getUser(),
  ]);
  let isAdmin = false;
  if (userRes.data.user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', userRes.data.user.id)
      .single();
    isAdmin = !!profile?.is_admin;
  }
  // Supabase types the embedded FK as an array (to-many shape) even with
  // the `!fk_name` to-one hint; cast through unknown since at runtime
  // these resolve to a single object.
  const allListings = (listingAgg.data ?? []) as unknown as Array<{
    id: string
    price: number
    condition: import('@/types/database').CardCondition
    grading_company: string | null
    grade: string | null
    quantity_available: number
    created_at: string
    seller: { display_name: string | null; username: string | null } | null
  }>;
  const allBids = (bidsAgg.data ?? []) as unknown as Array<{
    id: string
    price: number
    grading_company: string | null
    grade: string | null
    created_at: string
    user_id: string
    buyer: { display_name: string | null; username: string | null } | null
  }>;
  const marketPrice = card.price?.marketPrice ?? null;

  // Combined sales feed for the inline market-data drawer (raw + graded
  // pre-merged so the table sorts naturally by date). Each row carries
  // (company, grade) so the filter on CardMainPanel can keep them in
  // sync with whatever variant chip is selected.
  const combinedSales = [
    ...sales.map(s => ({
      date: s.date,
      price: Number(s.price),
      label: s.condition ?? 'NM',
      source: s.listing_type ?? 'sale',
      company: null as string | null,
      grade: null as string | null,
    })),
    ...gradedSales.map(g => ({
      date: g.date,
      price: Number(g.price),
      label: `${g.grading_company} ${g.grade}`,
      source: 'graded',
      company: g.grading_company as string | null,
      grade: g.grade as string | null,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  const asksForPanel = allListings.map(l => ({
    id: l.id,
    price: Number(l.price),
    condition: l.condition,
    grading_company: l.grading_company,
    grade: l.grade,
    quantity_available: l.quantity_available,
    created_at: l.created_at,
    sellerName: l.seller?.display_name || l.seller?.username || 'Seller',
  }));
  const bidsForPanel = allBids.map(b => ({
    id: b.id,
    price: Number(b.price),
    grading_company: b.grading_company,
    grade: b.grade,
    created_at: b.created_at,
    buyerName: b.buyer?.display_name || b.buyer?.username || 'Buyer',
    userId: b.user_id,
  }));

  // Build the unified variants list. Raw + each (company × grade) where
  // grade ≥ 9 OR the grade label is a top-of-line special ("Black Label
  // 10", "Pristine 10"). Variants surface either from inventory (someone's
  // listing one) or from population data (someone could theoretically grade
  // theirs and sell it). Either source qualifies — that's why the chip row
  // shows both "buyable now" and "open to offers" variants together.
  const variants = buildVariants(allListings, populations);
  const totalActiveListings = allListings.length;
  const parallelCards = await getParallelCards(card.baseId ?? card.id);
  // Drop self + any hidden variants (base C/UC/R/P/SR standards we don't
  // sell). The current card stays visible even if hidden, since the user
  // navigated here directly.
  const relatedCards = parallelCards.filter(c => c.id !== card.id && !isHiddenCard(c));

  // Bandai's official cardlist page. Each card on the page is an HTML
  // element with id={cardId}, so the fragment jumps directly to the row.
  // Useful in the debug block to verify our scraped rarity/stats match the
  // source of truth.
  const bandaiUrl = bandaiCardUrl(card.setId, card.id);

  return (
    <div>
      <RecordView id={card.id} name={card.name} imageUrl={card.imageUrl} />
      {/* Breadcrumbs */}
      <nav className="text-sm text-zinc-500 mb-6">
        <Link href="/" className="hover:text-zinc-900 transition-colors">Home</Link>
        <span className="mx-2">/</span>
        <Link href="/sets" className="hover:text-zinc-900 transition-colors">Sets</Link>
        <span className="mx-2">/</span>
        <Link href={`/${card.setId}`} className="hover:text-zinc-900 transition-colors">
          {card.setId.toUpperCase()}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-zinc-900">{card.name}</span>
      </nav>

      {/* Two-Column Layout: Image + Details. Uses the full root-layout
          width so on wide displays the chip row + trust band have room to
          breathe rather than collapsing into a narrow center column. */}
      <div className="grid grid-cols-1 md:grid-cols-[380px_1fr] gap-10 mb-12">
        {/* Left: Card Image */}
        <div className="flex justify-center md:sticky md:top-24 md:self-start">
          <Card3DPreview
            card={card}
            className="w-[300px] h-[420px] md:w-[360px] md:h-[504px]"
            priority
          />
        </div>

        {/* Right: Details + Market */}
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 mb-3">{card.name}</h1>

          {/* Debug: per-source field dump styled like a VSCode editor.
              Gated to admins server-side (no HTML shipped to other users)
              and toggleable client-side via the profile-dropdown switch. */}
          {isAdmin && <AdminDebugSection>
          <pre className="mb-3 text-xs font-mono bg-[#1e1e1e] border border-zinc-800 rounded-md px-3 py-2 overflow-x-auto leading-relaxed text-zinc-300">
            <span className="text-emerald-400"># debug: data sources</span>{'\n'}
            <span className="text-sky-400">cards</span>{'\n'}
            <span className="text-zinc-500">{'  id          '}</span><span className="text-orange-300">{card.id}</span>{'\n'}
            <span className="text-zinc-500">{'  name        '}</span><span className="text-orange-300">{card.name}</span>{'\n'}
            <span className="text-zinc-500">{'  rarity      '}</span><InlineCardFieldEdit cardId={card.id} field="rarity" current={card.rarity} options={RARITY_OPTIONS} fallback="C" />{'\n'}
            <span className="text-zinc-500">{'  type        '}</span><span className="text-orange-300">{card.type}</span>{'\n'}
            <span className="text-zinc-500">{'  art_style   '}</span><InlineCardFieldEdit cardId={card.id} field="art_style" current={card.artStyle ?? null} options={ART_STYLE_OPTIONS} fallback="standard" />{'\n'}
            <span className="text-zinc-500">{'  bandai_url  '}</span>
            {bandaiUrl ? (
              <a href={bandaiUrl} target="_blank" rel="noreferrer" className="text-cyan-400 hover:underline break-all">
                {bandaiUrl}
              </a>
            ) : (
              <span className="italic text-zinc-600">unknown set</span>
            )}{'\n'}
            {'\n'}
            <span className="text-sky-400">card_prices</span>{'\n'}
            <span className="text-zinc-500">{'  tcg_name    '}</span><span className="text-orange-300">{card.price?.tcgplayerProductName ?? <span className="italic text-zinc-600">none</span>}</span>{'\n'}
            <span className="text-zinc-500">{'  tcg_url     '}</span>
            {card.price?.tcgplayerUrl ? (
              <a href={card.price.tcgplayerUrl} target="_blank" rel="noreferrer" className="text-cyan-400 hover:underline break-all">
                {card.price.tcgplayerUrl}
              </a>
            ) : (
              <span className="italic text-zinc-600">none</span>
            )}{'\n'}
            <span className="text-zinc-500">{'  update      '}</span>
            <span className="inline-block align-top">
              <ManualUrlAssign cardId={card.id} refreshOnDone />
            </span>{'\n'}
            {'\n'}
            <span className="text-sky-400">pops_psa</span>{'\n'}
            {psaInfo ? (
              <>
                <span className="text-zinc-500">{'  set_code    '}</span><span className="text-orange-300">{psaInfo.set_code ?? <span className="italic text-zinc-600">—</span>}</span>{'\n'}
                <span className="text-zinc-500">{'  spec_id     '}</span><span className="text-orange-300">{psaInfo.spec_id}</span>{'\n'}
                <span className="text-zinc-500">{'  description '}</span><span className="text-orange-300">{psaInfo.description ?? <span className="italic text-zinc-600">—</span>}</span>{'\n'}
                <span className="text-zinc-500">{'  psa_url     '}</span>
                <a
                  href={`https://www.psacard.com/spec/psa/${psaInfo.spec_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-cyan-400 hover:underline break-all"
                >
                  https://www.psacard.com/spec/psa/{psaInfo.spec_id}
                </a>
              </>
            ) : (
              <span className="italic text-zinc-600">  unmapped</span>
            )}
          </pre>
          </AdminDebugSection>}

          {/* Buy/Offer panel + inline market-data drawer. The wrapper
              shares the selected-variant state between them so clicking
              a chip on the buy panel filters the asks/bids/sales tables
              below to that variant. */}
          <div className="mb-4">
            <CardMainPanel
              cardId={card.id}
              cardName={card.name}
              variants={variants}
              marketPrice={marketPrice}
              priceChangePercent={priceChange?.changePercent ?? null}
              asks={asksForPanel}
              bids={bidsForPanel}
              sales={combinedSales}
              currentUserId={userRes.data.user?.id ?? null}
            />
          </div>

          {/* Trust band — three reassurances above the fold so a buyer
              doesn't have to scroll to learn what they're committing to. */}
          <TrustBadges />

          <div className="mt-4 flex justify-end">
            <ShareButtons card={card} />
          </div>
        </div>
      </div>

      {/* Other Versions — promoted above sales. Full width so on wide
          displays we get more cards per row instead of leaving large
          gutters. Generous gaps keep the tiles from feeling cramped. */}
      {relatedCards.length > 0 && (
        <section className="mt-16 mb-16">
          <div className="flex items-baseline justify-between border-t border-zinc-200 pt-6 mb-6">
            <h2 className="text-lg font-bold text-zinc-900">Other Versions</h2>
            <p className="text-xs text-zinc-500 tabular-nums">
              {relatedCards.length} {relatedCards.length === 1 ? 'variant' : 'variants'}
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-x-6 gap-y-8">
            {relatedCards.map(alt => (
              <Link
                key={alt.id}
                href={`/card/${alt.id.toLowerCase()}`}
                className="block group"
              >
                <div className="transition-transform group-hover:-translate-y-1">
                  <CardThumbnail card={alt} />
                </div>
                <div className="mt-3 text-center">
                  <p className="text-sm font-semibold text-zinc-900 truncate group-hover:text-orange-500 transition-colors">
                    {alt.name}
                  </p>
                  <p className="text-[11px] text-zinc-400 font-mono mt-0.5">{alt.id}</p>
                  {alt.price?.marketPrice != null && (
                    <p className="text-sm font-bold tabular-nums text-zinc-900 mt-1">
                      ${alt.price.marketPrice.toFixed(2)}
                    </p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Recent Sales — stats + filters + chart + list. The full sales
          table lives on /market; this is a snapshot for at-a-glance signal. */}
      {(sales.length > 0 || gradedSales.length > 0) && (
        <section className="mt-16 mb-16">
          <div className="flex items-baseline justify-between border-t border-zinc-200 pt-6 mb-6">
            <h2 className="text-lg font-bold text-zinc-900">Recent Sales</h2>
            <Link
              href={`/card/${card.id.toLowerCase()}/market`}
              className="text-xs font-semibold text-orange-600 hover:text-orange-700"
            >
              View all →
            </Link>
          </div>
          <div className="bg-white border border-zinc-100 rounded-xl p-4">
            <RecentSales sales={sales} gradedSales={gradedSales} />
          </div>
        </section>
      )}

      {/* Populations were here as a standalone table; the data has moved
          into the variant chip row in the Buy panel above, where it's
          directly actionable rather than reference-only. */}

      {/* BreadcrumbList Schema */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(getBreadcrumbSchema([
            { name: "Home", url: SITE_URL },
            { name: "Sets", url: `${SITE_URL}/sets` },
            { name: `${card.setId.toUpperCase()} Cards`, url: `${SITE_URL}/${card.setId}` },
            { name: card.name, url: `${SITE_URL}/card/${card.id.toLowerCase()}` },
          ])),
        }}
      />

      {/* Enhanced Product Schema */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Product",
            name: `${card.name} (${card.id})`,
            description: card.effect || `${card.name} - ${card.type} card from ${card.setId.toUpperCase()} One Piece TCG`,
            image: card.imageUrl,
            sku: card.id,
            mpn: card.id,
            brand: {
              "@type": "Brand",
              name: "One Piece TCG",
            },
            manufacturer: {
              "@type": "Organization",
              name: "Bandai",
            },
            category: "Trading Card Games > One Piece TCG",
            additionalProperty: [
              {
                "@type": "PropertyValue",
                name: "Card Type",
                value: card.type,
              },
              {
                "@type": "PropertyValue",
                name: "Rarity",
                value: card.rarity,
              },
              {
                "@type": "PropertyValue",
                name: "Set",
                value: card.setId.toUpperCase(),
              },
              ...(card.power != null ? [{
                "@type": "PropertyValue",
                name: "Power",
                value: card.power.toString(),
              }] : []),
              ...(card.colors.length > 0 ? [{
                "@type": "PropertyValue",
                name: "Color",
                value: card.colors.join(", "),
              }] : []),
            ],
            ...(card.price?.marketPrice != null && {
              offers: {
                "@type": "Offer",
                price: card.price.marketPrice,
                priceCurrency: "USD",
                priceValidUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                availability: "https://schema.org/InStock",
                url: card.price.tcgplayerUrl || `${SITE_URL}/card/${card.id.toLowerCase()}`,
              },
            }),
          }),
        }}
      />
    </div>
  );
}
