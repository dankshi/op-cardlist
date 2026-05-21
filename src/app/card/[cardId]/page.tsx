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
import { CardThumbnail } from "@/components/card/CardThumbnail";
import { RecentSales } from "@/components/card/RecentSales";
import { CardPopulations } from "@/components/card/CardPopulations";
import { PriceChangeBadge } from "@/components/PriceChangeBadge";
import { ShareButtons } from "@/components/ShareButtons";
import { ListingsGrid } from "@/components/marketplace/ListingsGrid";
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
  const [sales, gradedSales, populations, psaInfo, priceChange, listingAgg] = await Promise.all([
    getCardSales(card.id, 90),
    getCardGradedSales(card.id, 90),
    getCardPopulations(card.id),
    getCardPsaInfo(card.id),
    calculatePriceChange(card.id, card.price?.marketPrice ?? null, 7),
    // Cheapest active Nomi listing + total active count.
    supabase
      .from("listings")
      .select("price", { count: "exact" })
      .eq("card_id", card.id)
      .eq("status", "active")
      .order("price", { ascending: true })
      .limit(1),
  ]);
  const lowestListingPrice = listingAgg.data?.[0]?.price ?? null;
  const activeListingCount = listingAgg.count ?? 0;
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

      {/* Two-Column Layout: Image + Details */}
      <div className="grid grid-cols-1 md:grid-cols-[360px_1fr] gap-8 mb-10">
        {/* Left: Card Image */}
        <div className="flex justify-center md:sticky md:top-24 md:self-start">
          <Card3DPreview
            card={card}
            className="w-[280px] h-[392px] md:w-[320px] md:h-[448px]"
            priority
          />
        </div>

        {/* Right: Details + Market */}
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 mb-3">{card.name}</h1>

          {/* Debug: per-source field dump styled like a VSCode editor.
              Dark theme makes it obviously dev-only and not part of the
              normal UI. Includes clickable links to verify against the
              source systems. */}
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

          {/* Price block — Nomi-first, market price as reference.
              If the card is listed on Nomi, the buy price is the headline.
              Otherwise we say "not currently listed" and show market for context. */}
          <div className="mb-4">
            {lowestListingPrice != null ? (
              <>
                <div className="flex items-baseline gap-2 flex-wrap">
                  {activeListingCount > 1 && (
                    <span className="text-sm text-zinc-500">from</span>
                  )}
                  <span className="text-3xl font-bold text-zinc-900">
                    ${Number(lowestListingPrice).toFixed(2)}
                  </span>
                  <span className="text-sm font-semibold text-orange-500">on Nomi</span>
                  {activeListingCount > 1 && (
                    <span className="text-xs text-zinc-400">
                      ({activeListingCount} listings)
                    </span>
                  )}
                </div>
                {card.price?.marketPrice != null && (
                  <div className="flex items-baseline gap-2 mt-1 text-sm text-zinc-500">
                    <span className="tabular-nums">${card.price.marketPrice.toFixed(2)}</span>
                    {card.price.tcgplayerUrl ? (
                      <a
                        href={card.price.tcgplayerUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-zinc-400 hover:text-orange-500 hover:underline"
                      >
                        TCGPlayer market ↗
                      </a>
                    ) : (
                      <span className="text-xs text-zinc-400">TCGPlayer market</span>
                    )}
                    {priceChange && (
                      <PriceChangeBadge changePercent={priceChange.changePercent} size="sm" />
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="text-lg font-medium text-zinc-700">
                  Not currently listed on Nomi
                </p>
                {card.price?.marketPrice != null && (
                  <div className="flex items-baseline gap-2 mt-1 text-sm text-zinc-500">
                    <span className="tabular-nums">${card.price.marketPrice.toFixed(2)}</span>
                    {card.price.tcgplayerUrl ? (
                      <a
                        href={card.price.tcgplayerUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-zinc-400 hover:text-orange-500 hover:underline"
                      >
                        TCGPlayer market ↗
                      </a>
                    ) : (
                      <span className="text-xs text-zinc-400">TCGPlayer market</span>
                    )}
                    {priceChange && (
                      <PriceChangeBadge changePercent={priceChange.changePercent} size="sm" />
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Marketplace section */}
          <div className="rounded-xl border border-zinc-200 bg-white p-4 mb-5">
            <ListingsGrid cardId={card.id} />
            <div className="mt-4 pt-3 border-t border-zinc-100">
              <Link
                href={`/sell?card=${encodeURIComponent(card.id)}`}
                className="block text-center py-2.5 rounded-lg border border-zinc-200 hover:border-orange-300 hover:bg-orange-50 text-sm font-medium text-zinc-700 transition-colors"
              >
                Sell This Card
              </Link>
            </div>
          </div>

          {/* Card details — hidden for now; restore from git if you need
              the gameplay metadata (colors, power, traits, effect, trigger)
              + TCGPlayer link + share buttons block. */}
          <div className="flex justify-end">
            <ShareButtons card={card} />
          </div>
        </div>
      </div>

      {/* Population (graded copies by company + grade) */}
      <section className="mb-6">
        <div className="bg-white border border-zinc-100 rounded-xl p-4">
          <CardPopulations populations={populations} />
        </div>
      </section>

      {/* Recent Sales — stats + filters + chart + list */}
      {(sales.length > 0 || gradedSales.length > 0) && (
        <section className="mb-8">
          <div className="bg-white border border-zinc-100 rounded-xl p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider">
                Recent Sales
              </h2>
            </div>
            <RecentSales sales={sales} gradedSales={gradedSales} />
          </div>
        </section>
      )}

      {/* Other Versions */}
      {relatedCards.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-bold text-zinc-900 mb-3">Other Versions</h2>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
            {relatedCards.map(alt => (
              <Link key={alt.id} href={`/card/${alt.id.toLowerCase()}`} className="block group">
                <CardThumbnail card={alt} />
                <div className="mt-1.5">
                  <p className="text-xs font-medium truncate group-hover:text-orange-500 transition-colors">{alt.name}</p>
                  <div className="flex items-center gap-1 text-[11px] text-zinc-400">
                    <span>{alt.id}</span>
                    {alt.price?.marketPrice != null && (
                      <span className="text-zinc-600 font-medium">${alt.price.marketPrice.toFixed(2)}</span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

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
