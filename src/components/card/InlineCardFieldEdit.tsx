'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  cardId: string
  /** Cards-table column being edited. The API whitelists which keys are
   *  actually writable (art_style, rarity). */
  field: 'art_style' | 'rarity'
  current: string | null
  options: readonly string[]
  /** Default value to use when current is null/empty (e.g. 'standard'
   *  for art_style, 'C' for rarity). */
  fallback: string
  /** 'dark' for the card debug section (dark VSCode-style code block);
   *  'light' for admin pages on white background. Defaults to dark. */
  theme?: 'dark' | 'light'
}

/** Generic inline dropdown for editing a single cards-row column from the
 *  card detail debug section. Optimistic — local select reflects the new
 *  value immediately; on failure we revert and surface the error.
 *  Admin-gated server-side via /api/admin/cards/[cardId]. */
export function InlineCardFieldEdit({ cardId, field, current, options, fallback, theme = 'dark' }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const initial = current ?? fallback
  const [value, setValue] = useState(initial)
  const [saved, setSaved] = useState(initial)
  const [state, setState] = useState<'idle' | 'saving' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value
    const prev = saved
    setValue(next)
    setState('saving')
    setError(null)
    try {
      const res = await fetch(`/api/admin/cards/${cardId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: next }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      setSaved(next)
      setState('done')
      // Force the server component to re-fetch so the page reflects the
      // new value (and removes the card entirely if it now passes
      // isHiddenCard). Without this the dropdown shows the new value
      // locally but the rest of the page renders with stale data.
      startTransition(() => router.refresh())
      setTimeout(() => setState('idle'), 1500)
    } catch (err) {
      setValue(prev)
      setError(err instanceof Error ? err.message : 'failed')
      setState('idle')
    }
  }

  const selectClass = theme === 'dark'
    ? 'bg-zinc-800 border border-zinc-700 text-orange-300 rounded px-1 py-0.5 text-xs disabled:opacity-50 cursor-pointer'
    : 'bg-white border border-zinc-300 text-zinc-700 rounded px-1 py-0 text-[10px] disabled:opacity-50 cursor-pointer'
  const optionBg = theme === 'dark' ? 'bg-zinc-900' : 'bg-white'

  return (
    <span className="inline-flex items-center gap-1">
      <select
        value={value}
        onChange={handleChange}
        disabled={state === 'saving'}
        className={selectClass}
      >
        {options.map(o => (
          <option key={o} value={o} className={optionBg}>{o}</option>
        ))}
      </select>
      {state === 'saving' && <span className="text-zinc-500 text-[10px]">…</span>}
      {state === 'done' && <span className="text-emerald-500 text-[10px]">✓</span>}
      {error && <span className="text-red-500 text-[10px]">{error}</span>}
    </span>
  )
}

export const ART_STYLE_OPTIONS = ['standard', 'alternate', 'manga', 'wanted', 'textured'] as const
export const RARITY_OPTIONS = ['C', 'UC', 'R', 'SR', 'SEC', 'L', 'P', 'SP', 'TR'] as const
