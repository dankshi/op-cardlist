import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getCardById, getAllCards } from "@/lib/cards";
import CardModalClient from "./CardModalClient";
import { SITE_URL, SITE_NAME, getCardKeywords, getBreadcrumbSchema } from "@/lib/seo";
import { Card3DPreview } from "@/components/card/Card3DPreview";

interface PageProps {
  params: Promise<{ cardId: string }>;
}

export async function generateStaticParams() {
  const cards = getAllCards();
  return cards.map((card) => ({
    cardId: card.id.toLowerCase(),
  }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { cardId } = await params;
  const card = getCardById(cardId.toUpperCase());

  if (!card) {
    return {
      title: "Card Not Found",
    };
  }

  const setUpper = card.setId.toUpperCase();
  const pageUrl = `${SITE_URL}/card/${card.id.toLowerCase()}`;

  // Build comprehensive description
  const stats = [
    card.type,
    card.power ? `${card.power} Power` : null,
    card.cost != null ? `Cost ${card.cost}` : null,
    card.counter ? `+${card.counter} Counter` : null,
  ].filter(Boolean).join(' | ');

  const priceInfo = card.price?.marketPrice != null
    ? ` Market price: $${card.price.marketPrice.toFixed(2)}.`
    : '';

  const description = `${card.name} (${card.id}) from ${setUpper}. ${stats}.${priceInfo} ${card.effect.slice(0, 120)}...`;

  return {
    title: `${card.name} (${card.id}) - ${setUpper} | One Piece TCG`,
    description,
    keywords: getCardKeywords(card.name, card.id, card.setId),
    openGraph: {
      title: `${card.name} - ${card.id} | One Piece TCG Card`,
      description: `${stats}.${priceInfo} ${card.effect.slice(0, 150)}`,
      url: pageUrl,
      siteName: SITE_NAME,
      type: "website",
      images: [
        {
          url: card.imageUrl,
          width: 245,
          height: 342,
          alt: `${card.name} - ${card.id} One Piece TCG Card`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${card.name} (${card.id}) - One Piece TCG`,
      description: `${stats}.${priceInfo}`,
      images: [card.imageUrl],
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
  const card = getCardById(cardId.toUpperCase());

  if (!card) {
    notFound();
  }

  return (
    <CardModalClient>
      <div className="flex flex-col md:flex-row max-h-[90vh]">
            {/* Card Image - Left Side with 3D Preview */}
            <div className="flex-shrink-0 bg-zinc-950 light:bg-zinc-100 p-4 md:p-6 flex items-center justify-center md:w-[340px] lg:w-[400px]">
              <Card3DPreview
                card={card}
                className="w-[200px] h-[280px] md:w-[280px] md:h-[392px] lg:w-[320px] lg:h-[448px]"
                priority
              />
            </div>

            {/* Card Details - Right Side */}
            <div className="flex-1 p-5 md:p-6 overflow-y-auto">
              {/* Header Row */}
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-zinc-400 light:text-zinc-600 font-mono">{card.id}</span>
                    <span className="px-2 py-0.5 bg-zinc-800 light:bg-zinc-200 rounded text-xs font-medium">{card.rarity}</span>
                    <span className="px-2 py-0.5 bg-zinc-800 light:bg-zinc-200 rounded text-xs">{card.type}</span>
                    {card.isParallel && (
                      <span className="px-2 py-0.5 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded text-xs font-medium">
                        {card.artStyle === 'wanted' ? 'WANTED' : card.artStyle === 'manga' ? 'MANGA' : 'ALT'}
                      </span>
                    )}
                  </div>
                  <h1 className="text-2xl md:text-3xl font-bold">{card.name}</h1>
                </div>
              </div>

              {/* Colors */}
              <div className="flex items-center gap-2 mb-4">
                {card.colors.map((color) => (
                  <div key={color} className="flex items-center gap-1.5">
                    <span className={`w-4 h-4 rounded-full ${colorClasses[color]}`} />
                    <span className="text-sm text-zinc-400 light:text-zinc-600">{color}</span>
                  </div>
                ))}
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-4 gap-3 mb-5">
                <div className="bg-zinc-800/50 light:bg-zinc-100 rounded-lg p-3 text-center">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wide">{card.type === "LEADER" ? "Life" : "Cost"}</p>
                  <p className="text-xl font-bold">{card.type === "LEADER" ? (card.life ?? "-") : (card.cost ?? "-")}</p>
                </div>
                <div className="bg-zinc-800/50 light:bg-zinc-100 rounded-lg p-3 text-center">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Power</p>
                  <p className="text-xl font-bold">{card.power?.toLocaleString() ?? "-"}</p>
                </div>
                <div className="bg-zinc-800/50 light:bg-zinc-100 rounded-lg p-3 text-center">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Counter</p>
                  <p className="text-xl font-bold">{card.counter ? `+${card.counter.toLocaleString()}` : "-"}</p>
                </div>
                <div className="bg-zinc-800/50 light:bg-zinc-100 rounded-lg p-3 text-center">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Attribute</p>
                  <p className="text-lg font-bold truncate">{card.attribute ?? "-"}</p>
                </div>
              </div>

              {/* Traits */}
              {card.traits.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-4">
                  {card.traits.map((trait) => (
                    <span key={trait} className="px-2.5 py-1 bg-zinc-800 light:bg-zinc-200 rounded-full text-xs text-zinc-300 light:text-zinc-700">
                      {trait}
                    </span>
                  ))}
                </div>
              )}

              {/* Effect */}
              <div className="mb-4">
                <h3 className="text-xs text-zinc-500 uppercase tracking-wide mb-2">Effect</h3>
                <p className="text-sm text-zinc-300 light:text-zinc-700 leading-relaxed">
                  {card.effect || "No effect."}
                </p>
              </div>

              {/* Trigger */}
              {card.trigger && (
                <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                  <h3 className="text-xs text-amber-400 uppercase tracking-wide mb-1">Trigger</h3>
                  <p className="text-sm text-zinc-300 light:text-zinc-700">{card.trigger}</p>
                </div>
              )}

              {/* Price Section */}
              {card.price && (card.price.marketPrice != null || card.price.tcgplayerUrl) && (
                <div className="p-4 bg-zinc-800/50 light:bg-zinc-100 rounded-lg border border-zinc-700/50 light:border-zinc-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-6">
                      {card.price.marketPrice != null && (
                        <div>
                          <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Market Price</p>
                          <p className="text-2xl font-bold text-green-400">${card.price.marketPrice.toFixed(2)}</p>
                        </div>
                      )}
                      {card.price.lowPrice != null && (
                        <div>
                          <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Low</p>
                          <p className="text-lg font-semibold">${card.price.lowPrice.toFixed(2)}</p>
                        </div>
                      )}
                      {card.price.highPrice != null && (
                        <div>
                          <p className="text-[10px] text-zinc-500 uppercase tracking-wide">High</p>
                          <p className="text-lg font-semibold">${card.price.highPrice.toFixed(2)}</p>
                        </div>
                      )}
                    </div>
                    {card.price.tcgplayerUrl && (
                      <a
                        href={card.price.tcgplayerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded-lg transition-colors"
                      >
                        Buy on TCGPlayer
                      </a>
                    )}
                  </div>
                  {card.price.lastUpdated && (
                    <p className="text-[10px] text-zinc-500 mt-2">
                      Updated {new Date(card.price.lastUpdated).toLocaleDateString()}
                    </p>
                  )}
                </div>
              )}

              {/* Set Info */}
              <div className="mt-4 pt-4 border-t border-zinc-800 light:border-zinc-200">
                <p className="text-xs text-zinc-500">
                  Set: <span className="text-zinc-300 light:text-zinc-700 font-medium">{card.setId.toUpperCase()}</span>
                </p>
              </div>
            </div>
          </div>

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
                "@type": "AggregateOffer",
                priceCurrency: "USD",
                lowPrice: card.price.lowPrice ?? card.price.marketPrice,
                highPrice: card.price.highPrice ?? card.price.marketPrice,
                offerCount: 1,
                availability: "https://schema.org/InStock",
                url: card.price.tcgplayerUrl,
                seller: {
                  "@type": "Organization",
                  name: "TCGPlayer",
                },
              },
            }),
          }),
        }}
      />
    </CardModalClient>
  );
}
