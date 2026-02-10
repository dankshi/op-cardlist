import type { Metadata } from "next";
import { getAllProducts } from "@/lib/products";
import { SITE_URL, BASE_KEYWORDS } from "@/lib/seo";
import ProductGrid from "@/components/ProductGrid";

export const metadata: Metadata = {
  title: "Products - Booster Packs, Starter Decks & Accessories",
  description: "Browse all One Piece TCG products including booster packs, starter decks, card sleeves, playmats, and more. View release dates and MSRP pricing.",
  keywords: [...BASE_KEYWORDS, "products", "booster packs", "starter decks", "card sleeves", "playmats", "accessories"],
  alternates: {
    canonical: `${SITE_URL}/products`,
  },
};

export default function ProductsPage() {
  const products = getAllProducts();

  const boosterCount = products.filter(p => p.category === 'boosters').length;
  const deckCount = products.filter(p => p.category === 'decks').length;
  const otherCount = products.filter(p => p.category === 'other').length;

  return (
    <div>
      <section className="mb-8">
        <h1 className="text-4xl font-bold mb-4">Products</h1>
        <p className="text-zinc-400 light:text-zinc-600 text-lg mb-4">
          Browse {products.length} official One Piece TCG products.
        </p>
        <div className="flex flex-wrap gap-3 text-sm">
          <span className="px-3 py-1 bg-zinc-800 light:bg-zinc-100 rounded-full text-zinc-300 light:text-zinc-700">
            {boosterCount} Boosters
          </span>
          <span className="px-3 py-1 bg-zinc-800 light:bg-zinc-100 rounded-full text-zinc-300 light:text-zinc-700">
            {deckCount} Decks
          </span>
          <span className="px-3 py-1 bg-zinc-800 light:bg-zinc-100 rounded-full text-zinc-300 light:text-zinc-700">
            {otherCount} Accessories
          </span>
        </div>
      </section>

      <ProductGrid products={products} />

      {/* CollectionPage Schema */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: "One Piece TCG Products",
            description: `Browse ${products.length} official One Piece TCG products including booster packs, starter decks, and accessories`,
            url: `${SITE_URL}/products`,
            mainEntity: {
              "@type": "ItemList",
              name: "One Piece TCG Products",
              numberOfItems: products.length,
              itemListElement: products.slice(0, 50).map((product, index) => ({
                "@type": "ListItem",
                position: index + 1,
                url: product.detailUrl,
                name: product.name,
                ...(product.msrp && { description: product.msrp }),
              })),
            },
          }),
        }}
      />
    </div>
  );
}
