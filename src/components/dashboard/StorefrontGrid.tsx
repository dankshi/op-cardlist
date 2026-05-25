'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { ConditionBadge } from '@/components/marketplace/ConditionBadge'
import type { Listing } from '@/types/database'

export type StorefrontKind = 'selling' | 'collection'

interface Props {
  listings: Listing[]
  /** Which slice of the seller's inventory this grid shows.
   *  selling = `status='active'` (live on marketplace)
   *  collection = `status='delisted'` (owned but not for sale) */
  kind: StorefrontKind
  /** card_id → image URL fallback when the listing has no photo_urls. */
  cardImages: Record<string, string>
  /** Notify parent when a listing changes (price update / status flip) so
   *  the dashboard stats stay in sync without a full reload. */
  onListingsChange: (updated: Listing[]) => void
}

type SortOption = 'recent' | 'price-desc' | 'price-asc' | 'name-asc'

const SORT_LABELS: Record<SortOption, string> = {
  'recent': 'Recently added',
  'price-desc': 'Price: High to low',
  'price-asc': 'Price: Low to high',
  'name-asc': 'Name: A–Z',
}

/** Seller's storefront — visual grid of their own listings, modeled after
 *  the public /[setId] browse experience but with inline price edit and
 *  a deep-link to /sell/[id]/edit for the full form. The `kind` prop
 *  switches between actively-selling (status='active') and parked-in-
 *  collection (status='delisted') views. Sold listings stay hidden. */
export function StorefrontGrid({ listings, kind, cardImages, onListingsChange }: Props) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortOption>('recent')

  const targetStatus = kind === 'selling' ? 'active' : 'delisted'

  const visibleListings = useMemo(() => {
    const q = query.trim().toLowerCase()
    const tokens = q.length === 0 ? [] : q.split(/\s+/)
    return listings
      .filter(l => l.status === targetStatus)
      .filter(l => {
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
  }, [listings, query, sort, targetStatus])

  const totalInKind = listings.filter(l => l.status === targetStatus).length

  function handleListingUpdate(updated: Listing) {
    onListingsChange(listings.map(l => l.id === updated.id ? updated : l))
  }

  function handleListingDelete(id: string) {
    onListingsChange(listings.filter(l => l.id !== id))
  }

  const emptyCopy = kind === 'selling'
    ? {
        none:    "You're not selling anything right now.",
        nomatch: "No active listings match your search.",
        cta:     "List a card →",
        ctaHref: "/sell",
      }
    : {
        none:    "Your collection is empty.",
        nomatch: "Nothing in your collection matches your search.",
        cta:     "Move a listing here →",
        ctaHref: null,
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
            placeholder={kind === 'selling' ? 'Search your active listings…' : 'Search your collection…'}
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
        Showing {visibleListings.length} of {totalInKind} {kind === 'selling' ? 'active listing' : 'card'}{visibleListings.length === 1 ? '' : 's'}.
      </p>

      {visibleListings.length === 0 ? (
        <div className="text-center py-16 text-zinc-500">
          <p>{totalInKind === 0 ? emptyCopy.none : query ? emptyCopy.nomatch : emptyCopy.none}</p>
          {totalInKind === 0 && emptyCopy.ctaHref && (
            <Link href={emptyCopy.ctaHref} className="mt-3 inline-block text-orange-500 hover:text-orange-600 font-medium">
              {emptyCopy.cta}
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-x-4 gap-y-6">
          {visibleListings.map(listing => (
            <ListingTile
              key={listing.id}
              listing={listing}
              kind={kind}
              imageUrl={listing.photo_urls?.[0] || cardImages[listing.card_id] || null}
              onUpdate={handleListingUpdate}
              onDelete={handleListingDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ListingTile({
  listing,
  kind,
  imageUrl,
  onUpdate,
  onDelete,
}: {
  listing: Listing
  kind: StorefrontKind
  imageUrl: string | null
  onUpdate: (l: Listing) => void
  onDelete: (id: string) => void
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
          {kind === 'collection' && (
            <div className="absolute top-2 left-2">
              <span className="px-2 py-0.5 rounded bg-zinc-900/80 text-white text-[10px] font-semibold uppercase tracking-wider backdrop-blur-sm">
                In collection
              </span>
            </div>
          )}
          {listing.quantity_available > 1 && (
            <div className="absolute top-2 right-2">
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-orange-500/95 text-white text-[10px] font-semibold uppercase tracking-wider backdrop-blur-sm shadow-sm"
                title={`${listing.quantity_available} available`}
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
                </svg>
                ×{listing.quantity_available}
              </span>
            </div>
          )}
        </div>
      </Link>

      {/* Bottom row mirrors the gallery's PriceRow — price on the left,
          contextual primary action on the right, kebab for less-common
          ops. The primary action flips with `kind` so the most-likely
          next step is one tap away. */}
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="mb-1">
            <ConditionBadge
              condition={listing.condition}
              gradingCompany={listing.grading_company}
              grade={listing.grade}
            />
          </div>
          <InlinePriceEdit listing={listing} onUpdate={onUpdate} />
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {kind === 'selling' ? (
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
          ) : (
            <ListForSaleButton listing={listing} onUpdate={onUpdate} />
          )}
          <ActionMenu listing={listing} kind={kind} onUpdate={onUpdate} onDelete={onDelete} />
        </div>
      </div>
    </div>
  )
}

function ListForSaleButton({
  listing,
  onUpdate,
}: {
  listing: Listing
  onUpdate: (l: Listing) => void
}) {
  const [busy, setBusy] = useState(false)
  const supabase = useMemo(() => createClient(), [])

  async function list() {
    setBusy(true)
    const { error } = await supabase
      .from('listings')
      .update({ status: 'active' })
      .eq('id', listing.id)
    setBusy(false)
    if (error) {
      alert(`Couldn't list for sale: ${error.message}`)
      return
    }
    onUpdate({ ...listing, status: 'active' })
  }

  return (
    <button
      type="button"
      onClick={list}
      disabled={busy}
      aria-label="List this card for sale"
      title="List this card for sale"
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold uppercase tracking-wider text-emerald-700 ring-1 ring-emerald-500/40 bg-white hover:bg-emerald-600 hover:text-white hover:ring-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-wait"
    >
      {busy ? '…' : 'List'}
      {!busy && (
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
        </svg>
      )}
    </button>
  )
}

function ActionMenu({
  listing,
  kind,
  onUpdate,
  onDelete,
}: {
  listing: Listing
  kind: StorefrontKind
  onUpdate: (l: Listing) => void
  onDelete: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  async function moveToCollection() {
    setBusy(true)
    setOpen(false)
    const { error } = await supabase
      .from('listings')
      .update({ status: 'delisted' })
      .eq('id', listing.id)
    setBusy(false)
    if (error) {
      alert(`Couldn't move to collection: ${error.message}`)
      return
    }
    onUpdate({ ...listing, status: 'delisted' })
  }

  async function deleteListing() {
    setOpen(false)
    if (!confirm(`Permanently delete this listing for ${listing.title}? This can't be undone. If you just want to stop selling it, move it to your collection instead.`)) return

    setBusy(true)
    const { error } = await supabase
      .from('listings')
      .delete()
      .eq('id', listing.id)

    if (error) {
      setBusy(false)
      const isFkError = /foreign key|violates/i.test(error.message)
      if (isFkError) {
        // Order history exists — never silently move the card into the
        // collection (a sold card was never "owned-not-listed"). Surface
        // the constraint and let the seller find the order instead.
        alert("This card has order history and can't be permanently deleted. Check your Orders tab to find the sale.")
        return
      }
      alert(`Failed to delete: ${error.message}`)
      return
    }

    onDelete(listing.id)
  }

  // Order history exists if any units have been sold off this listing
  // (qty_available < qty). FK constraint prevents hard-delete in that
  // case, so don't even offer the option — and show a clearer alternative.
  const hasOrderHistory = listing.quantity_available < listing.quantity

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        disabled={busy}
        aria-label="More actions"
        title="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center justify-center w-7 h-7 rounded-md ring-1 ring-zinc-200 bg-white text-zinc-500 hover:text-zinc-900 hover:ring-zinc-400 transition-colors disabled:opacity-50 disabled:cursor-wait"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M10 3a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0 5.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0 5.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3z" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 w-44 rounded-md bg-white ring-1 ring-zinc-200 shadow-lg py-1 z-20"
        >
          {kind === 'selling' ? (
            <button
              type="button"
              role="menuitem"
              onClick={moveToCollection}
              className="w-full text-left px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Move to collection
            </button>
          ) : (
            <Link
              role="menuitem"
              href={`/sell/${listing.id}/edit`}
              className="block w-full text-left px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              onClick={() => setOpen(false)}
            >
              Edit details
            </Link>
          )}
          {hasOrderHistory ? (
            <span
              className="block w-full text-left px-3 py-1.5 text-xs font-medium text-zinc-400"
              title="Listings with order history can't be deleted — view the sale in your Orders tab."
            >
              Has sale history
            </span>
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={deleteListing}
              className="w-full text-left px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50"
            >
              Delete permanently…
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function InlinePriceEdit({ listing, onUpdate }: { listing: Listing; onUpdate: (l: Listing) => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(Number(listing.price).toFixed(2))
  const [saving, setSaving] = useState(false)
  const [state, setState] = useState<'idle' | 'done' | 'error'>('idle')
  const supabase = useMemo(() => createClient(), [])

  async function save(): Promise<boolean> {
    const parsed = parseFloat(value)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setState('error')
      return false
    }
    if (parsed === Number(listing.price)) {
      setEditing(false)
      return true
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
      return false
    }
    onUpdate({ ...listing, price: parsed })
    setState('done')
    setEditing(false)
    setTimeout(() => setState('idle'), 1500)
    return true
  }

  function cancel() {
    setEditing(false)
    setValue(Number(listing.price).toFixed(2))
    setState('idle')
  }

  if (editing) {
    return (
      // Wrap input + hint so the hint can float absolutely without pushing
      // the surrounding row (the cause of the previous layout shift).
      <div className="relative">
        <div className="flex items-baseline gap-0.5">
          <span className="text-lg font-semibold text-zinc-500 leading-none">$</span>
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={value}
            onChange={e => setValue(e.target.value)}
            onBlur={() => { if (!saving) save() }}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); save() }
              else if (e.key === 'Escape') { e.preventDefault(); cancel() }
            }}
            autoFocus
            onFocus={e => e.currentTarget.select()}
            disabled={saving}
            // Match the static price's text size + line-height + width so
            // the surrounding flex row doesn't move when we toggle between
            // display and edit states.
            className="w-24 text-lg font-semibold tabular-nums text-zinc-900 leading-none bg-transparent border-b-2 border-orange-500 focus:outline-none px-0 py-0.5 -mb-0.5"
          />
        </div>
        <p className="absolute top-full left-0 mt-1 text-[10px] text-zinc-400 whitespace-nowrap pointer-events-none">
          {saving ? 'Saving…' : (
            <>
              <kbd className="font-sans">↵</kbd> save · <kbd className="font-sans">esc</kbd> cancel
            </>
          )}
        </p>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => { setValue(Number(listing.price).toFixed(2)); setEditing(true); setState('idle') }}
      title="Click to edit price"
      className="group/price inline-flex items-baseline gap-1.5 text-left cursor-pointer"
    >
      <span className="text-lg font-semibold tabular-nums text-zinc-900 leading-none border-b-2 border-dashed border-zinc-300 group-hover/price:border-orange-500 group-hover/price:text-orange-600 transition-colors pb-0.5 -mb-0.5">
        ${Number(listing.price).toFixed(2)}
      </span>
      <svg
        className="w-3 h-3 text-zinc-400 group-hover/price:text-orange-500 transition-colors shrink-0 self-center"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
      {state === 'done' && <span className="text-emerald-500 text-xs">✓</span>}
      {state === 'error' && <span className="text-red-500 text-xs">!</span>}
    </button>
  )
}
