import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { getCardById, getAllCards } from "@/lib/cards";

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

  return {
    title: `${card.name} (${card.id}) - One Piece TCG`,
    description: `${card.name} from ${card.setId.toUpperCase()}. ${card.type} card with ${card.power ? card.power + ' power' : ''}. ${card.effect.slice(0, 150)}...`,
    openGraph: {
      title: `${card.name} - One Piece TCG`,
      description: card.effect.slice(0, 200),
      images: [card.imageUrl],
    },
  };
}

const colorClasses: Record<string, string> = {
  Red: "bg-red-500",
  Green: "bg-green-500",
  Blue: "bg-blue-500",
  Purple: "bg-purple-500",
  Black: "bg-zinc-500",
  Yellow: "bg-yellow-500",
};

export default async function CardPage({ params }: PageProps) {
  const { cardId } = await params;
  const card = getCardById(cardId.toUpperCase());

  if (!card) {
    notFound();
  }

  return (
    <div>
      {/* Breadcrumb */}
      <nav className="text-sm text-zinc-500 mb-6">
        <Link href="/" className="hover:text-white transition-colors">
          Home
        </Link>
        <span className="mx-2">/</span>
        <Link href={`/${card.setId}`} className="hover:text-white transition-colors">
          {card.setId.toUpperCase()}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-white">{card.id}</span>
      </nav>

      <div className="grid md:grid-cols-[300px,1fr] lg:grid-cols-[400px,1fr] gap-8">
        {/* Card Image */}
        <div className="aspect-[2.5/3.5] relative rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">
          <Image
            src={card.imageUrl}
            alt={card.name}
            fill
            sizes="(max-width: 768px) 100vw, 400px"
            className="object-cover"
            priority
            unoptimized
          />
        </div>

        {/* Card Details */}
        <div>
          <div className="flex items-center gap-3 mb-2">
            <span className="text-zinc-500">{card.id}</span>
            <span className="px-2 py-0.5 bg-zinc-800 rounded text-sm">{card.rarity}</span>
            <span className="px-2 py-0.5 bg-zinc-800 rounded text-sm">{card.type}</span>
          </div>

          <h1 className="text-3xl font-bold mb-4">{card.name}</h1>

          {/* Colors */}
          <div className="flex items-center gap-2 mb-6">
            {card.colors.map((color) => (
              <span
                key={color}
                className={`px-3 py-1 rounded-full text-sm ${colorClasses[color]} text-white`}
              >
                {color}
              </span>
            ))}
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            {card.type === "LEADER" ? (
              <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
                <p className="text-xs text-zinc-500 uppercase">Life</p>
                <p className="text-2xl font-bold">{card.life ?? "-"}</p>
              </div>
            ) : (
              <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
                <p className="text-xs text-zinc-500 uppercase">Cost</p>
                <p className="text-2xl font-bold">{card.cost ?? "-"}</p>
              </div>
            )}
            <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
              <p className="text-xs text-zinc-500 uppercase">Power</p>
              <p className="text-2xl font-bold">{card.power?.toLocaleString() ?? "-"}</p>
            </div>
            <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
              <p className="text-xs text-zinc-500 uppercase">Counter</p>
              <p className="text-2xl font-bold">{card.counter?.toLocaleString() ?? "-"}</p>
            </div>
            {card.attribute && (
              <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
                <p className="text-xs text-zinc-500 uppercase">Attribute</p>
                <p className="text-2xl font-bold">{card.attribute}</p>
              </div>
            )}
          </div>

          {/* Traits */}
          {card.traits.length > 0 && (
            <div className="mb-6">
              <h2 className="text-xs text-zinc-500 uppercase mb-2">Type</h2>
              <div className="flex flex-wrap gap-2">
                {card.traits.map((trait) => (
                  <span
                    key={trait}
                    className="px-3 py-1 bg-zinc-800 rounded-full text-sm"
                  >
                    {trait}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Effect */}
          <div className="mb-6">
            <h2 className="text-xs text-zinc-500 uppercase mb-2">Effect</h2>
            <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
              <p className="text-zinc-300 leading-relaxed whitespace-pre-wrap">
                {card.effect || "No effect."}
              </p>
            </div>
          </div>

          {/* Trigger */}
          {card.trigger && (
            <div className="mb-6">
              <h2 className="text-xs text-zinc-500 uppercase mb-2">Trigger</h2>
              <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
                <p className="text-zinc-300 leading-relaxed">{card.trigger}</p>
              </div>
            </div>
          )}

          {/* Set Info */}
          <div className="pt-4 border-t border-zinc-800">
            <p className="text-sm text-zinc-500">
              From{" "}
              <Link
                href={`/${card.setId}`}
                className="text-red-400 hover:text-red-300 transition-colors"
              >
                {card.setId.toUpperCase()}
              </Link>
            </p>
          </div>
        </div>
      </div>

      {/* JSON-LD Structured Data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Product",
            name: card.name,
            description: card.effect,
            image: card.imageUrl,
            sku: card.id,
            brand: {
              "@type": "Brand",
              name: "One Piece TCG",
            },
            category: "Trading Card",
          }),
        }}
      />
    </div>
  );
}
