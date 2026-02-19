import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { getAllCards } from '@/lib/cards';
import { getAllCharacterSlugs, buildCharacterIndex } from '@/lib/characters';
import { SITE_URL, SITE_NAME, getBreadcrumbSchema } from '@/lib/seo';

interface PageProps {
  params: Promise<{ name: string }>;
}

export async function generateStaticParams() {
  const slugs = getAllCharacterSlugs();
  return slugs.map((slug) => ({ name: slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { name: slug } = await params;
  const allCards = await getAllCards();
  const index = buildCharacterIndex(allCards);
  const character = index.find((c) => c.slug === slug);

  if (!character) {
    return { title: 'Character Not Found' };
  }

  const versions = character.cards.length;
  const sets = new Set(character.cards.map((c) => c.setId.toUpperCase()));
  const topCard = [...character.cards].sort(
    (a, b) => (b.price?.marketPrice ?? 0) - (a.price?.marketPrice ?? 0)
  )[0];
  const topPrice = topCard?.price?.marketPrice;
  const priceText =
    topPrice != null ? ` Most expensive: $${topPrice.toFixed(2)}.` : '';

  const pageUrl = `${SITE_URL}/character/${slug}`;
  const ogImage = topCard?.imageUrl;

  return {
    title: `${character.name} - All ${versions} Cards | One Piece TCG`,
    description: `Browse all ${versions} versions of ${character.name} across ${sets.size} sets in One Piece TCG.${priceText} Compare prices and find every version.`,
    keywords: [
      character.name,
      `${character.name} One Piece card`,
      `${character.name} One Piece TCG`,
      `${character.name} card price`,
      `${character.name} all versions`,
      'One Piece TCG',
    ],
    openGraph: {
      title: `${character.name} - ${versions} Versions | One Piece TCG`,
      description: `All ${versions} versions of ${character.name} across ${sets.size} sets.${priceText}`,
      url: pageUrl,
      siteName: SITE_NAME,
      type: 'website',
      ...(ogImage && {
        images: [
          {
            url: ogImage,
            width: 245,
            height: 342,
            alt: `${character.name} One Piece TCG`,
          },
        ],
      }),
    },
    twitter: {
      card: 'summary',
      title: `${character.name} - ${versions} Cards`,
      description: `All ${versions} versions of ${character.name}.${priceText}`,
      ...(ogImage && { images: [ogImage] }),
    },
    alternates: {
      canonical: pageUrl,
    },
  };
}

export default async function CharacterPage({ params }: PageProps) {
  const { name: slug } = await params;
  const allCards = await getAllCards();
  const index = buildCharacterIndex(allCards);
  const character = index.find((c) => c.slug === slug);

  if (!character) {
    notFound();
  }

  // Group cards by set
  const cardsBySet = new Map<string, typeof character.cards>();
  for (const card of character.cards) {
    const setCards = cardsBySet.get(card.setId) || [];
    setCards.push(card);
    cardsBySet.set(card.setId, setCards);
  }

  // Sort each set's cards by price descending
  for (const cards of cardsBySet.values()) {
    cards.sort(
      (a, b) => (b.price?.marketPrice ?? 0) - (a.price?.marketPrice ?? 0)
    );
  }

  const totalVersions = character.cards.length;
  const setsCount = cardsBySet.size;

  return (
    <div>
      {/* Breadcrumb */}
      <nav className="text-sm text-zinc-500 mb-6">
        <Link
          href="/"
          className="hover:text-white light:hover:text-zinc-900 transition-colors"
        >
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-white light:text-zinc-900">{character.name}</span>
      </nav>

      <header className="mb-8">
        <h1 className="text-3xl font-bold mb-2">{character.name}</h1>
        <p className="text-zinc-400 light:text-zinc-600">
          {totalVersions} version{totalVersions !== 1 ? 's' : ''} across{' '}
          {setsCount} set{setsCount !== 1 ? 's' : ''}
        </p>
      </header>

      {/* Cards grouped by set */}
      <div className="space-y-8">
        {Array.from(cardsBySet.entries()).map(([setId, cards]) => (
          <section key={setId}>
            <h2 className="text-lg font-semibold mb-3">
              <Link
                href={`/${setId}`}
                className="hover:text-sky-400 transition-colors"
              >
                {setId.toUpperCase()}
              </Link>
            </h2>
            <div className="grid gap-3">
              {cards.map((card) => (
                <Link
                  key={card.id}
                  href={`/card/${card.id.toLowerCase()}`}
                  className="flex items-center gap-4 px-4 py-3 bg-zinc-800/50 light:bg-zinc-100 border border-zinc-700/50 light:border-zinc-200 rounded-lg hover:border-zinc-600 light:hover:border-zinc-300 transition-colors"
                >
                  <Image
                    src={card.imageUrl}
                    alt={card.name}
                    width={48}
                    height={67}
                    className="rounded object-cover shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium truncate">{card.name}</span>
                      {card.isParallel && (
                        <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded text-xs font-medium shrink-0">
                          {card.artStyle === 'wanted'
                            ? 'WANTED'
                            : card.artStyle === 'manga'
                              ? 'MANGA'
                              : 'ALT'}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-zinc-500">
                      {card.id} · {card.rarity} · {card.type}
                      {card.power != null &&
                        ` · ${card.power.toLocaleString()} Power`}
                    </span>
                  </div>
                  {card.price?.marketPrice != null && (
                    <span className="text-green-400 font-bold shrink-0">
                      ${card.price.marketPrice.toFixed(2)}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* BreadcrumbList Schema */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            getBreadcrumbSchema([
              { name: 'Home', url: SITE_URL },
              {
                name: character.name,
                url: `${SITE_URL}/character/${slug}`,
              },
            ])
          ),
        }}
      />
    </div>
  );
}
