import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getCardById, getAllCards } from "@/lib/cards";
import CardModalClient from "./CardModalClient";
import { SITE_URL, SITE_NAME, getCardKeywords, getBreadcrumbSchema } from "@/lib/seo";
import { Card3DPreview } from "@/components/card/Card3DPreview";
import { ShareButtons } from "@/components/ShareButtons";

interface PageProps {
  params: Promise<{ cardId: string }>;
}

export async function generateStaticParams() {
  const cards = await getAllCards();
  return cards.map((card) => ({
    cardId: card.id.toLowerCase(),
  }));
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

  // Build comprehensive description with price for virality
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
  const description = `${pricePrefix}${card.name} (${card.id}) from ${setUpper}. ${stats}. ${card.effect.slice(0, 100)}...`;

  // Dynamic OG image with price overlay
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

              {/* Price */}
              {card.price?.marketPrice != null && (
                <div className="mb-4 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                  <h3 className="text-xs text-green-400 uppercase tracking-wide mb-1">TCGPlayer Price</h3>
                  <div className="flex items-center justify-between">
                    <span className="text-xl font-bold text-green-400">${card.price.marketPrice.toFixed(2)}</span>
                    {card.price.tcgplayerUrl && (
                      <a
                        href={card.price.tcgplayerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-green-400 hover:text-green-300 underline"
                      >
                        View on TCGPlayer
                      </a>
                    )}
                  </div>
                  {(card.price.lowestPrice != null || card.price.medianPrice != null) && (
                    <p className="text-xs text-zinc-500 mt-1">
                      {card.price.lowestPrice != null && `Low: $${card.price.lowestPrice.toFixed(2)}`}
                      {card.price.lowestPrice != null && card.price.medianPrice != null && ' • '}
                      {card.price.medianPrice != null && `Median: $${card.price.medianPrice.toFixed(2)}`}
                    </p>
                  )}
                  {card.price.lastSoldPrice != null && (
                    <p className="text-xs text-zinc-500 mt-1">
                      Last sold: ${card.price.lastSoldPrice.toFixed(2)}
                      {card.price.lastSoldDate && ` (${new Date(card.price.lastSoldDate).toLocaleDateString()})`}
                    </p>
                  )}
                </div>
              )}

              {/* Share Buttons */}
              <div className="mb-4">
                <ShareButtons card={card} />
              </div>

              {/* Set Info */}
              <div className="mt-4 pt-4 border-t border-zinc-800 light:border-zinc-200">
                <p className="text-xs text-zinc-500">
                  Set: <span className="text-zinc-300 light:text-zinc-700 font-medium">{card.setId.toUpperCase()}</span>
                </p>
                {card.price?.tcgplayerProductId != null && (
                  <p className="text-xs text-zinc-500 mt-1">
                    TCGPlayer ID: <span className="text-zinc-300 light:text-zinc-700 font-mono">{card.price.tcgplayerProductId}</span>
                  </p>
                )}
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
          }),
        }}
      />
    </CardModalClient>
  );
}
