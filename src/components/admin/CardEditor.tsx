'use client'

/* eslint-disable @next/next/no-img-element */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { InlineCardFieldEdit, ART_STYLE_OPTIONS as INLINE_ART_STYLE_OPTIONS, RARITY_OPTIONS } from '@/components/card/InlineCardFieldEdit'
import { ManualUrlAssign } from '@/components/admin/ManualUrlAssign'
import { PsaSpecManualLink } from '@/components/admin/PsaSpecManualLink'
import { bandaiCardUrl } from '@/lib/bandai-sets'

export interface EditableCard {
  id: string
  name: string
  set_id: string
  type: string | null
  rarity: string | null
  art_style: string | null
  variant: string | null
  image_url: string | null
  // Visibility info pre-computed server-side (mirrors isHiddenByFields()).
  // Lets the client dim hidden tiles and the modal explain the reason
  // without re-deriving the rule.
  isHidden: boolean
  hideReason: string | null
  hideFix: string | null
  // Audit issues — non-fatal warnings the admin should look at. Flag
  // appears as a ⚠ badge on the tile; the modal lists the messages.
  issues: string[]
}

interface CardDetail {
  card: EditableCard & { base_id: string }
  mapping: {
    tcgplayer_product_id: number
    tcgplayer_url: string | null
    tcgplayer_name: string | null
    source: 'auto' | 'manual' | 'review'
    mapped_by: string | null
    updated_at: string
  } | null
  psa: {
    spec_id: number
    description: string | null
    set_code: string | null
    variety: string | null
    total_pop: number | null
    psa_card_number: string | null
  } | null
}

interface Props {
  cards: EditableCard[]
}

// Re-exported via INLINE_ART_STYLE_OPTIONS for the filter dropdown so
// the list-level filter and the inline edit always agree on the legal set.
const ART_STYLE_OPTIONS = INLINE_ART_STYLE_OPTIONS

export function CardEditor({ cards }: Props) {
  const [query, setQuery] = useState('')
  const [setFilter, setSetFilter] = useState<string>('')
  const [artStyleFilter, setArtStyleFilter] = useState<string>('')
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | 'visible' | 'hidden'>('all')
  const [selected, setSelected] = useState<EditableCard | null>(null)

  const setOptions = useMemo(() => {
    const set = new Set<string>()
    for (const c of cards) set.add(c.set_id)
    return Array.from(set).sort()
  }, [cards])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const tokens = q.length === 0 ? [] : q.split(/\s+/)
    return cards.filter(c => {
      if (setFilter && c.set_id !== setFilter) return false
      if (artStyleFilter && (c.art_style ?? 'standard') !== artStyleFilter) return false
      if (visibilityFilter === 'visible' && c.isHidden) return false
      if (visibilityFilter === 'hidden' && !c.isHidden) return false
      if (tokens.length === 0) return true
      // Every token must hit somewhere in id, name, or set_id.
      const haystack = `${c.id} ${c.name} ${c.set_id}`.toLowerCase()
      return tokens.every(t => haystack.includes(t))
    })
  }, [cards, query, setFilter, artStyleFilter, visibilityFilter])

  // Group filtered cards by set. Within each set, visible cards come
  // first (sorted by id), then a separator, then hidden cards. This
  // makes hidden cards easy to skim for audit but keeps the visible
  // worklist front-and-center.
  const sections = useMemo(() => {
    const bySet = new Map<string, { visible: EditableCard[]; hidden: EditableCard[] }>()
    for (const c of filtered) {
      const bucket = bySet.get(c.set_id) ?? { visible: [], hidden: [] }
      if (c.isHidden) bucket.hidden.push(c)
      else bucket.visible.push(c)
      bySet.set(c.set_id, bucket)
    }
    for (const b of bySet.values()) {
      b.visible.sort((a, b) => a.id.localeCompare(b.id))
      b.hidden.sort((a, b) => a.id.localeCompare(b.id))
    }
    return Array.from(bySet.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered])

  const visibleCount = filtered.filter(c => !c.isHidden).length
  const hiddenCount = filtered.length - visibleCount

  return (
    <>
      <div className="sticky top-0 z-10 bg-white pb-3 mb-3 border-b border-zinc-200">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by id, name, or set…"
            className="flex-1 min-w-[260px] px-3 py-2 rounded-lg border border-zinc-300 text-sm focus:outline-none focus:border-orange-500"
            autoFocus
          />
          <select
            value={setFilter}
            onChange={e => setSetFilter(e.target.value)}
            className="px-2 py-2 rounded-lg border border-zinc-300 text-sm bg-white"
          >
            <option value="">All sets</option>
            {setOptions.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            value={artStyleFilter}
            onChange={e => setArtStyleFilter(e.target.value)}
            className="px-2 py-2 rounded-lg border border-zinc-300 text-sm bg-white"
          >
            <option value="">Any art style</option>
            {ART_STYLE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            value={visibilityFilter}
            onChange={e => setVisibilityFilter(e.target.value as typeof visibilityFilter)}
            className="px-2 py-2 rounded-lg border border-zinc-300 text-sm bg-white"
          >
            <option value="all">All cards</option>
            <option value="visible">Visible only</option>
            <option value="hidden">Hidden only</option>
          </select>
          {(query || setFilter || artStyleFilter || visibilityFilter !== 'all') && (
            <button
              onClick={() => { setQuery(''); setSetFilter(''); setArtStyleFilter(''); setVisibilityFilter('all') }}
              className="text-xs text-zinc-500 hover:text-zinc-900 px-2"
            >
              Clear
            </button>
          )}
        </div>
        <p className="text-xs text-zinc-500 mt-2">
          Showing {filtered.length.toLocaleString()} of {cards.length.toLocaleString()} cards
          {' '}({visibleCount.toLocaleString()} visible · {hiddenCount.toLocaleString()} hidden).
          Click any tile to edit.
        </p>
      </div>

      {sections.length === 0 ? (
        <p className="text-sm text-zinc-500 italic py-8 text-center">No cards match.</p>
      ) : (
        <div className="space-y-3">
          {sections.map(([setId, { visible, hidden }]) => {
            const total = visible.length + hidden.length
            return (
              <details key={setId} open={sections.length <= 5 || total <= 40} className="border border-zinc-200 rounded-lg">
                <summary className="cursor-pointer px-4 py-2 bg-zinc-50 hover:bg-zinc-100 font-medium flex items-center gap-3 text-sm">
                  <span className="font-mono">{setId}</span>
                  <span className="text-zinc-500">— {total} card{total === 1 ? '' : 's'}</span>
                  {hidden.length > 0 && (
                    <span className="text-xs text-zinc-400 font-normal">
                      ({visible.length} visible, {hidden.length} hidden)
                    </span>
                  )}
                </summary>
                <div className="p-4">
                  {visible.length > 0 && (
                    <CardGallery cards={visible} onSelect={setSelected} />
                  )}
                  {hidden.length > 0 && (
                    <>
                      <div className="flex items-center gap-2 mt-6 mb-3">
                        <span className="text-xs uppercase tracking-wide font-medium text-zinc-500">
                          Hidden ({hidden.length})
                        </span>
                        <div className="flex-1 h-px bg-zinc-200" />
                      </div>
                      <CardGallery cards={hidden} onSelect={setSelected} dimmed />
                    </>
                  )}
                </div>
              </details>
            )
          })}
        </div>
      )}

      {selected && (
        <CardEditModal
          card={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  )
}

function Chip({ children, variant = 'neutral' }: { children: React.ReactNode; variant?: 'neutral' | 'accent' }) {
  const cls = variant === 'accent'
    ? 'bg-blue-100 text-blue-700'
    : 'bg-zinc-100 text-zinc-600'
  return <span className={`px-1.5 py-0.5 rounded ${cls}`}>{children}</span>
}

/** Responsive image grid. Each tile splits into two zones: the image +
 *  id/name area opens the modal (button), the art_style dropdown is a
 *  sibling control so the select doesn't end up nested in a button
 *  (invalid HTML). Issue + hidden badges overlay the image. */
function CardGallery({ cards, onSelect, dimmed = false }: {
  cards: EditableCard[]
  onSelect: (c: EditableCard) => void
  dimmed?: boolean
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
      {cards.map(c => (
        <div
          key={c.id}
          className={`group rounded-lg border border-zinc-200 hover:border-orange-400 hover:shadow-md transition-all overflow-hidden bg-white ${
            dimmed ? 'opacity-50 hover:opacity-100' : ''
          }`}
        >
          <button
            onClick={() => onSelect(c)}
            className="block w-full text-left cursor-pointer focus:outline-none"
            title="Click to edit"
          >
            <div className="aspect-[5/7] bg-zinc-100 relative">
              {c.image_url ? (
                <img src={c.image_url} alt={c.name} className="w-full h-full object-cover" loading="lazy" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-zinc-400 text-xs">no img</div>
              )}
              {c.issues.length > 0 && (
                <span
                  className="absolute top-1.5 left-1.5 text-[11px] bg-amber-500 text-white w-5 h-5 rounded-full flex items-center justify-center font-bold shadow"
                  title={c.issues.join(' · ')}
                >
                  ⚠
                </span>
              )}
              {c.isHidden && (
                <span className="absolute top-1.5 right-1.5 text-[10px] bg-zinc-900/80 text-white px-1.5 py-0.5 rounded">
                  hidden
                </span>
              )}
            </div>
            <div className="px-2 pt-2 pb-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] text-blue-600 truncate">{c.id}</span>
                <span className="text-[10px] bg-zinc-100 text-zinc-700 px-1.5 py-0.5 rounded flex-shrink-0">
                  {c.rarity ?? '—'}
                </span>
              </div>
              <div className="font-semibold text-xs text-zinc-900 truncate mt-0.5" title={c.name}>{c.name}</div>
            </div>
          </button>
          <div className="px-2 pb-2 flex items-center justify-between gap-2 text-[10px] text-zinc-500">
            <span className="text-[10px] uppercase tracking-wide">art</span>
            <InlineCardFieldEdit
              cardId={c.id}
              field="art_style"
              current={c.art_style}
              options={INLINE_ART_STYLE_OPTIONS}
              fallback="standard"
              theme="light"
            />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Full-detail modal for a single card. Big image on the left, structured
 *  sections (Card / TCGplayer link / PSA pop) on the right. Each section
 *  is white, matching the rest of the site. Loads mapping + PSA detail
 *  lazily on open. */
function CardEditModal({ card, onClose }: { card: EditableCard; onClose: () => void }) {
  const [detail, setDetail] = useState<CardDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/admin/cards/${card.id}/detail`)
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error ?? `HTTP ${res.status}`)
        }
        const data = await res.json() as CardDetail
        if (!cancelled) setDetail(data)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'failed to load detail')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [card.id])

  const bandaiUrl = bandaiCardUrl(card.set_id, card.id)

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl max-w-6xl w-full max-h-[92vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-zinc-200 flex items-start justify-between gap-4 sticky top-0 bg-white z-10">
          <div className="min-w-0">
            <h2 className="font-semibold text-zinc-900 text-xl truncate">{card.name}</h2>
            <p className="text-sm text-zinc-500 mt-1 flex items-center gap-2 flex-wrap">
              <span className="font-mono">{card.id}</span>
              <span>·</span>
              <span>{card.set_id}</span>
              <span>·</span>
              <Link href={`/card/${card.id}`} target="_blank" className="text-blue-600 hover:underline">
                public card page ↗
              </Link>
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-900 text-3xl leading-none flex-shrink-0 cursor-pointer"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-6 flex gap-6">
          <div className="w-80 flex-shrink-0">
            {card.image_url ? (
              <img src={card.image_url} alt={card.name} className="w-full rounded-lg border border-zinc-200 shadow-sm" />
            ) : (
              <div className="w-full aspect-[5/7] bg-zinc-100 rounded-lg border border-zinc-200 flex items-center justify-center text-zinc-400 text-sm">
                no image
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0 space-y-4">
            {card.issues.length > 0 && (
              <div className="border border-amber-200 bg-amber-50 rounded-md p-3 text-sm">
                <div className="font-semibold text-amber-900 mb-1 flex items-center gap-1.5">
                  <span>⚠</span>
                  <span>Issues to address ({card.issues.length})</span>
                </div>
                <ul className="text-amber-800 list-disc list-inside space-y-0.5">
                  {card.issues.map(issue => <li key={issue}>{issue}</li>)}
                </ul>
              </div>
            )}
            {card.isHidden && card.hideReason && (
              <div className="border border-zinc-300 bg-zinc-50 rounded-md p-3 text-sm">
                <div className="font-semibold text-zinc-900 mb-1 flex items-center gap-1.5">
                  <span>🚫</span>
                  <span>Hidden from public site</span>
                </div>
                <p className="text-zinc-700">{card.hideReason}</p>
                {card.hideFix && (
                  <p className="text-zinc-600 mt-2"><span className="font-semibold">Fix:</span> {card.hideFix}</p>
                )}
              </div>
            )}
            {loading && !detail ? (
              <div className="text-sm text-zinc-500 border border-zinc-200 rounded-md px-4 py-6 text-center">
                loading detail…
              </div>
            ) : error ? (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
                {error}
              </div>
            ) : detail ? (
              <DetailPanel card={card} detail={detail} bandaiUrl={bandaiUrl} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Replaces the old dark debug block with a clean white panel — three
 *  sections (Card / TCGplayer link / PSA pop), each with field labels on
 *  the left and inline edits / links on the right. */
function DetailPanel({
  card,
  detail,
  bandaiUrl,
}: {
  card: EditableCard
  detail: CardDetail
  bandaiUrl: string | null
}) {
  const { mapping, psa } = detail
  return (
    <div className="space-y-5">
      <Section title="Card">
        <Field label="rarity">
          <InlineCardFieldEdit cardId={card.id} field="rarity" current={card.rarity} options={RARITY_OPTIONS} fallback="C" theme="light" />
        </Field>
        <Field label="art_style">
          <InlineCardFieldEdit cardId={card.id} field="art_style" current={card.art_style} options={INLINE_ART_STYLE_OPTIONS} fallback="standard" theme="light" />
        </Field>
        <Field label="type">{card.type ?? <Empty />}</Field>
        <Field label="variant">{card.variant ?? <Empty />}</Field>
        {bandaiUrl && (
          <Field label="bandai">
            <a href={bandaiUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline break-all">
              view on Bandai ↗
            </a>
          </Field>
        )}
      </Section>

      <Section title="TCGplayer link">
        <Field label="name">{mapping?.tcgplayer_name ?? <Empty />}</Field>
        <Field label="url">
          {mapping?.tcgplayer_url ? (
            <a href={mapping.tcgplayer_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline break-all">
              {mapping.tcgplayer_url}
            </a>
          ) : <Empty />}
        </Field>
        {mapping?.source && (
          <Field label="source">
            <SourceChip source={mapping.source} />
          </Field>
        )}
        <Field label="update">
          <ManualUrlAssign cardId={card.id} refreshOnDone />
        </Field>
      </Section>

      <Section title="PSA pop">
        {psa ? (
          <>
            <Field label="spec id">
              <a
                href={`https://www.psacard.com/spec/psa/${psa.spec_id}`}
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 hover:underline"
              >
                {psa.spec_id} ↗
              </a>
            </Field>
            <Field label="description">{psa.description ?? <Empty />}</Field>
            {psa.variety && <Field label="variety">{psa.variety}</Field>}
            <Field label="set / number">
              <span className="text-zinc-700">
                {psa.set_code ?? '—'}
                {psa.psa_card_number ? ` · #${psa.psa_card_number}` : ''}
              </span>
            </Field>
            {psa.total_pop != null && <Field label="total pop">{psa.total_pop.toLocaleString()}</Field>}
          </>
        ) : (
          <p className="text-sm text-zinc-500 italic">No PSA spec linked.</p>
        )}
        <Field label="update">
          <PsaSpecManualLink cardId={card.id} />
        </Field>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-zinc-200 rounded-lg overflow-hidden">
      <div className="px-4 py-2 bg-zinc-50 border-b border-zinc-200">
        <h3 className="text-xs uppercase tracking-wide font-semibold text-zinc-600">{title}</h3>
      </div>
      <div className="divide-y divide-zinc-100">{children}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 px-4 py-2 text-sm">
      <span className="text-zinc-500 w-28 flex-shrink-0">{label}</span>
      <span className="flex-1 min-w-0 text-zinc-900">{children}</span>
    </div>
  )
}

function SourceChip({ source }: { source: 'auto' | 'manual' | 'review' }) {
  const cls =
    source === 'manual' ? 'bg-blue-100 text-blue-700' :
    source === 'review' ? 'bg-amber-100 text-amber-700' :
    'bg-emerald-100 text-emerald-700'
  return <span className={`px-1.5 py-0.5 rounded text-xs ${cls}`}>{source}</span>
}

function Empty({ children = 'none' }: { children?: React.ReactNode }) {
  return <span className="italic text-zinc-400">{children}</span>
}
