import type { Metadata } from 'next'
import { getBrowsableCards } from '@/lib/cards'
import { createClient } from '@/lib/supabase/server'
import { SITE_URL, BASE_KEYWORDS } from '@/lib/seo'
import { MarketplaceContent } from '@/components/marketplace/MarketplaceContent'
import type { EnrichedListing } from '@/components/home/ListingCarousel'

export const metadata: Metadata = {
  title: 'Marketplace — Browse All Listings',
  description: 'Browse all active listings on nomi market. Filter by grading company (PSA, CGC, BGS, TAG), grade, price range, and more. Every card authenticated before shipping.',
  keywords: [...BASE_KEYWORDS, 'buy cards', 'PSA 10', 'graded cards', 'BGS black label', 'CGC 10', 'marketplace'],
  alternates: {
    canonical: `${SITE_URL}/marketplace`,
  },
}

export default async function MarketplacePage() {
  const allCards = await getBrowsableCards()
  const cardMap: Record<string, { name: string; imageUrl: string }> = {}
  for (const card of allCards) {
    cardMap[card.id] = { name: card.name, imageUrl: card.imageUrl }
  }

  let initialListings: EnrichedListing[] = []

  try {
    const supabase = await createClient()
    const { data } = await supabase
      .from('listings')
      .select('*')
      .eq('status', 'active')
      .order('price', { ascending: true })
      .range(0, 499)

    if (data) {
      initialListings = data
        .map(listing => {
          const card = cardMap[listing.card_id]
          if (!card) return null
          return {
            id: listing.id,
            card_id: listing.card_id,
            cardName: card.name,
            cardImageUrl: card.imageUrl,
            price: listing.price,
            condition: listing.condition,
            grading_company: listing.grading_company || null,
            grade: listing.grade || null,
            createdAt: listing.created_at,
          } as EnrichedListing
        })
        .filter((l): l is EnrichedListing => l !== null)
    }
  } catch {
    // Supabase unavailable
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-zinc-900">Marketplace</h1>
        <p className="text-zinc-500 mt-1">Browse all active listings</p>
      </div>
      <MarketplaceContent
        initialListings={initialListings}
        cardMap={cardMap}
      />
    </div>
  )
}
