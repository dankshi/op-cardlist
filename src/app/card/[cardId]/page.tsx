import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { getCardById, getParallelCards } from "@/lib/cards";
import { getCardSales, calculatePriceChange } from "@/lib/price-history";
import { SITE_URL, SITE_NAME, getCardKeywords, getBreadcrumbSchema } from "@/lib/seo";
import { Card3DPreview } from "@/components/card/Card3DPreview";
import { CardThumbnail } from "@/components/card/CardThumbnail";
import { PriceHistoryChart } from "@/components/card/PriceHistoryChart";
import { PriceChangeBadge } from "@/components/PriceChangeBadge";
import { ShareButtons } from "@/components/ShareButtons";
import { ListingsGrid } from "@/components/marketplace/ListingsGrid";

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

const colorClasses: Record<string, string> = {
  Red: "bg-red-500",
  Green: "bg-green-500",
  Blue: "bg-blue-500",
  Purple: "bg-purple-500",
  Black: "bg-zinc-600",
  Yellow: "bg-yellow-500",
};

export default async function CardPage({ params }: PageProps) {
  const { cardId } = await params;
  const card = await getCardById(cardId.toUpperCase());

  if (!card) {
    notFound();
  }

  const sales = await getCardSales(card.id, 30);
  const priceChange = await calculatePriceChange(card.id, card.price?.marketPrice ?? null, 7);
  const parallelCards = await getParallelCards(card.baseId ?? card.id);
  const relatedCards = parallelCards.filter(c => c.id !== card.id);

  return (
    <div>
      {/* Breadcrumbs */}
      <nav className="text-sm text-zinc-500 mb-6">
        <Link href="/" className="hover:text-zinc-900 transition-colors">Home</Link>
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
          {/* Card Identity */}
          <div className="flex items-center gap-2 mb-1 text-xs text-zinc-500">
            <span className="font-mono">{card.id}</span>
            <span className="px-1.5 py-0.5 bg-zinc-100 rounded">{card.rarity}</span>
            <span className="px-1.5 py-0.5 bg-zinc-100 rounded">{card.type}</span>
            {card.isParallel && (
              <span className="px-1.5 py-0.5 bg-amber-50 text-amber-600 border border-amber-200 rounded font-medium">
                {card.artStyle === 'wanted' ? 'WANTED' : card.artStyle === 'manga' ? 'MANGA' : 'ALT'}
              </span>
            )}
            <span className="text-zinc-300">|</span>
            <Link href={`/${card.setId}`} className="hover:text-orange-500 transition-colors">
              {card.setId.toUpperCase()}
            </Link>
          </div>
          <h1 className="text-2xl font-bold text-zinc-900 mb-3">{card.name}</h1>

          {/* Price */}
          {card.price?.marketPrice != null && (
            <div className="flex items-baseline gap-3 mb-4">
              <span className="text-3xl font-bold text-zinc-900">
                ${card.price.marketPrice.toFixed(2)}
              </span>
              {priceChange && (
                <PriceChangeBadge changePercent={priceChange.changePercent} size="sm" />
              )}
              <span className="text-xs text-zinc-400">TCGPlayer Market</span>
            </div>
          )}

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

          {/* Card details */}
          <div className="rounded-xl border border-zinc-200 bg-white p-4">
            <h3 className="text-xs font-semibold text-zinc-700 uppercase tracking-wide mb-3">Card Details</h3>
            <div className="text-xs text-zinc-500 space-y-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
              {card.colors.map((color) => (
                <span key={color} className="inline-flex items-center gap-1">
                  <span className={`w-2 h-2 rounded-full ${colorClasses[color]}`} />
                  {color}
                </span>
              ))}
              <span>{card.type === "LEADER" ? "Life" : "Cost"} {card.type === "LEADER" ? (card.life ?? "-") : (card.cost ?? "-")}</span>
              <span>Power {card.power?.toLocaleString() ?? "-"}</span>
              {card.counter != null && <span>Counter +{card.counter.toLocaleString()}</span>}
              {card.attribute && <span>{card.attribute}</span>}
            </div>
            {card.traits.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {card.traits.map((trait) => (
                  <span key={trait} className="px-1.5 py-0.5 bg-zinc-100 rounded text-[11px]">{trait}</span>
                ))}
              </div>
            )}
            <p className="text-zinc-500 leading-relaxed">{card.effect || "No effect."}</p>
            {card.trigger && (
              <p><span className="text-amber-600 font-medium">Trigger:</span> {card.trigger}</p>
            )}
            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                {card.price?.lowestPrice != null && <span>Low ${card.price.lowestPrice.toFixed(2)}</span>}
                {card.price?.medianPrice != null && <span>Med ${card.price.medianPrice.toFixed(2)}</span>}
                {card.price?.tcgplayerUrl && (
                  <a href={card.price.tcgplayerUrl} target="_blank" rel="noopener noreferrer" className="hover:text-orange-500 transition-colors">TCGPlayer</a>
                )}
              </div>
              <ShareButtons card={card} />
            </div>
          </div>
          </div>
        </div>
      </div>

      {/* Sales Chart */}
      {sales.length > 1 && (
        <section className="mb-8">
          <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wide mb-3">Recent Sales</h2>
          <div className="bg-white border border-zinc-100 rounded-xl p-4">
            <PriceHistoryChart data={sales} />
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
