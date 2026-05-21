'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import type { Listing } from '@/types/database'

interface Props {
  listings: Listing[]
  /** card_id → image URL fallback when the listing has no photo_urls. */
  cardImages: Record<string, string>
  /** Notify parent when a listing changes (price update / status flip) so
   *  the dashboard stats stay in sync without a full reload. */
  onListingsChange: (updated: Listing[]) => void
}

type SortOption = 'recent' | 'price-desc' | 'price-asc' | 'name-asc'
type StatusFilter = 'active' | 'delisted' | 'all'

const SORT_LABELS: Record<SortOption, string> = {
  'recent': 'Recently added',
  'price-desc': 'Price: High to low',
  'price-asc': 'Price: Low to high',
  'name-asc': 'Name: A–Z',
}

/** Seller's storefront — visual grid of their own listings, modeled after
 *  the public /sets/[id] browse experience but with inline price edit and
 *  a deep-link to /sell/[id]/edit for the full form. Sold listings stay
 *  hidden; active vs delisted is a filter pill. */
export function StorefrontGrid({ listings, cardImages, onListingsChange }: Props) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortOption>('recent')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')

  // Sold listings live in /dashboard order history — they're not part of
  // the inventory you're managing. Everything else goes through the
  // active/delisted filter pills.
  const visibleListings = useMemo(() => {
    const q = query.trim().toLowerCase()
    const tokens = q.length === 0 ? [] : q.split(/\s+/)
    return listings
      .filter(l => l.status !== 'sold')
      .filter(l => {
        if (statusFilter !== 'all' && l.status !== statusFilter) return false
        if (tokens.length === 0) return true
        const haystack = `${l.title} ${l.card_id}`.toLowerCase()
        return tokens.every(t => haystack.includes(t))
      })
      .sort((a, b) => {
        switch (sort) {
          case 'price-desc': return Number(b.price) - Number(a.price)
          case 'price-asc': return Number(a.price) - Number(b.price)
          case 'name-asc': return a.title.localeCompare(b.title)
          case 'recent':
          default: return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        }
      })
  }, [listings, query, sort, statusFilter])

  // Status-pill counts always reflect the unfiltered totals so admin
  // sees the full picture (no "0 active" surprises when a search is on).
  const activeCount = listings.filter(l => l.status === 'active').length
  const delistedCount = listings.filter(l => l.status === 'delisted').length

  function handleListingUpdate(updated: Listing) {
    onListingsChange(listings.map(l => l.id === updated.id ? updated : l))
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[240px]">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
          </svg>
          <input
            type="text"
            placeholder="Search your inventory…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full pl-10 pr-9 py-2.5 bg-white border border-zinc-200 rounded-lg text-zinc-900 placeholder:text-zinc-400 text-sm focus:outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-900/5 transition-all"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 inline-flex items-center justify-center rounded-full text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 transition-colors"
            >
              ×
            </button>
          )}
        </div>

        <div className="inline-flex rounded-lg border border-zinc-200 bg-white p-0.5">
          {([
            { v: 'active', label: `Active (${activeCount})` },
            { v: 'delisted', label: `Delisted (${delistedCount})` },
            { v: 'all', label: 'All' },
          ] as { v: StatusFilter; label: string }[]).map(opt => (
            <button
              key={opt.v}
              onClick={() => setStatusFilter(opt.v)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                statusFilter === opt.v
                  ? 'bg-zinc-900 text-white'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <select
            value={sort}
            onChange={e => setSort(e.target.value as SortOption)}
            className="appearance-none pl-3 pr-8 py-2 rounded-md border border-zinc-200 bg-white text-sm font-medium text-zinc-900 hover:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900/5 transition-colors cursor-pointer"
          >
            {(Object.keys(SORT_LABELS) as SortOption[]).map(opt => (
              <option key={opt} value={opt}>{SORT_LABELS[opt]}</option>
            ))}
          </select>
          <svg className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      <p className="text-xs text-zinc-500 mb-4">
        Showing {visibleListings.length} of {listings.filter(l => l.status !== 'sold').length} listing{visibleListings.length === 1 ? '' : 's'}.
      </p>

      {visibleListings.length === 0 ? (
        <div className="text-center py-16 text-zinc-500">
          <p>
            {listings.length === 0
              ? "No listings yet."
              : query
                ? "No listings match your search."
                : `No ${statusFilter} listings.`}
          </p>
          {listings.length === 0 && (
            <Link href="/sell" className="mt-3 inline-block text-orange-500 hover:text-orange-600 font-medium">
              Create your first listing →
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-x-4 gap-y-6">
          {visibleListings.map(listing => (
            <ListingTile
              key={listing.id}
              listing={listing}
              imageUrl={listing.photo_urls?.[0] || cardImages[listing.card_id] || null}
              onUpdate={handleListingUpdate}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ListingTile({
  listing,
  imageUrl,
  onUpdate,
}: {
  listing: Listing
  imageUrl: string | null
  onUpdate: (l: Listing) => void
}) {
  return (
    <div className="block group">
      <Link href={`/sell/${listing.id}/edit`} className="block">
        <div className="aspect-[2.5/3.5] relative rounded-lg overflow-hidden bg-zinc-100 ring-1 ring-zinc-100 group-hover:ring-zinc-300 transition-all">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt={listing.title}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, (max-width: 1024px) 25vw, 20vw"
              className="object-cover"
              unoptimized
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-zinc-400 text-xs">
              no image
            </div>
          )}
          {listing.status === 'delisted' && (
            <div className="absolute inset-0 bg-zinc-900/60 flex items-center justify-center">
              <span className="px-2 py-1 rounded bg-white/95 text-zinc-900 text-xs font-semibold uppercase tracking-wider">
                Delisted
              </span>
            </div>
          )}
        </div>
      </Link>

      {/* Bottom row mirrors the gallery's PriceRow — price on the left,
          action affordance on the right. We drop the name + condition +
          quantity since the image already identifies the card; full
          details live on the edit page (pencil icon). */}
      <div className="mt-2 flex items-end justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-500 font-medium">
            Listed
          </div>
          <InlinePriceEdit listing={listing} onUpdate={onUpdate} />
        </div>
        <Link
          href={`/sell/${listing.id}/edit`}
          aria-label="Edit full listing"
          title="Edit full listing"
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold uppercase tracking-wider text-orange-600 ring-1 ring-orange-500/40 bg-white group-hover:bg-orange-500 group-hover:text-white group-hover:ring-orange-500 transition-colors"
        >
          Edit
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </div>
    </div>
  )
}

function InlinePriceEdit({ listing, onUpdate }: { listing: Listing; onUpdate: (l: Listing) => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(Number(listing.price).toFixed(2))
  const [saving, setSaving] = useState(false)
  const [state, setState] = useState<'idle' | 'done' | 'error'>('idle')
  const supabase = useMemo(() => createClient(), [])

  async function save() {
    const parsed = parseFloat(value)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setState('error')
      return
    }
    // Skip the round-trip when nothing changed.
    if (parsed === Number(listing.price)) {
      setEditing(false)
      return
    }
    setSaving(true)
    setState('idle')
    const { error } = await supabase
      .from('listings')
      .update({ price: parsed })
      .eq('id', listing.id)
    setSaving(false)
    if (error) {
      setState('error')
      return
    }
    onUpdate({ ...listing, price: parsed })
    setState('done')
    setEditing(false)
    setTimeout(() => setState('idle'), 1500)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1 flex-1 min-w-0">
        <span className="text-zinc-500 text-sm">$</span>
        <input
          type="number"
          step="0.01"
          min="0.01"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') save()
            else if (e.key === 'Escape') { setEditing(false); setValue(Number(listing.price).toFixed(2)); setState('idle') }
          }}
          autoFocus
          disabled={saving}
          className="flex-1 min-w-0 w-16 px-2 py-1 text-sm tabular-nums rounded border border-orange-300 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
        />
        <button
          onClick={save}
          disabled={saving}
          className="text-xs font-semibold text-orange-600 hover:text-orange-700 disabled:opacity-50"
        >
          {saving ? '…' : 'Save'}
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => { setValue(Number(listing.price).toFixed(2)); setEditing(true); setState('idle') }}
      className="group/price text-left flex items-baseline gap-1.5 hover:bg-zinc-50 rounded px-1 -mx-1 transition-colors cursor-pointer"
      title="Click to edit price"
    >
      <span className="text-lg font-semibold tabular-nums text-zinc-900">
        ${Number(listing.price).toFixed(2)}
      </span>
      {state === 'done' && <span className="text-emerald-500 text-xs">✓</span>}
      {state === 'error' && <span className="text-red-500 text-xs">!</span>}
    </button>
  )
}
