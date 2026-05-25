'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

interface RaffleFields {
  id: string
  title: string
  prize_description: string
  prize_image_url: string | null
  status: 'active' | 'drawn' | 'cancelled'
  ends_at: string | null
}

/** Convert ISO string from the DB into the "YYYY-MM-DDTHH:MM" shape
 *  that <input type="datetime-local"> expects. Renders in the admin's
 *  local timezone so the time they see matches the time they typed. */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Parse a datetime-local string as local time and return a UTC ISO
 *  string for storage. Empty input → null (clears the field). */
function localInputToIso(s: string): string | null {
  if (!s) return null
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

export function RaffleEditForm({ raffle }: { raffle: RaffleFields }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const [title, setTitle] = useState(raffle.title)
  const [prizeDesc, setPrizeDesc] = useState(raffle.prize_description)
  const [prizeImage, setPrizeImage] = useState(raffle.prize_image_url || '')
  const [status, setStatus] = useState<'active' | 'drawn' | 'cancelled'>(raffle.status)
  const [endsAt, setEndsAt] = useState(isoToLocalInput(raffle.ends_at))

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/admin/raffles/${raffle.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          prize_description: prizeDesc.trim(),
          prize_image_url: prizeImage.trim() || null,
          status,
          ends_at: localInputToIso(endsAt),
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setMessage({ kind: 'err', text: j.error || 'Save failed' })
        return
      }
      setMessage({ kind: 'ok', text: 'Saved.' })
      startTransition(() => router.refresh())
    } catch {
      setMessage({ kind: 'err', text: 'Network error' })
    } finally {
      setSubmitting(false)
    }
  }

  const busy = submitting || pending

  return (
    <form onSubmit={save} className="bg-white border border-zinc-200 rounded-xl p-6 space-y-5">
      <h2 className="text-lg font-bold text-zinc-900">Edit raffle</h2>

      <Field label="Title">
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          required
          className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500"
        />
      </Field>

      <Field label="Prize description">
        <input
          type="text"
          value={prizeDesc}
          onChange={e => setPrizeDesc(e.target.value)}
          required
          className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500"
        />
      </Field>

      <Field label="Prize image URL" hint="Relative path (e.g. /homeBanner/op13_banner.webp) or full URL.">
        <input
          type="text"
          value={prizeImage}
          onChange={e => setPrizeImage(e.target.value)}
          className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500 font-mono text-sm"
          placeholder="/homeBanner/op13_banner.webp"
        />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <Field label="Draw date" hint="Your local time. Leave blank for TBA.">
          <input
            type="datetime-local"
            value={endsAt}
            onChange={e => setEndsAt(e.target.value)}
            className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500"
          />
        </Field>

        <Field label="Status">
          <select
            value={status}
            onChange={e => setStatus(e.target.value as 'active' | 'drawn' | 'cancelled')}
            className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500"
          >
            <option value="active">Active</option>
            <option value="drawn">Drawn</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </Field>
      </div>

      <div className="flex items-center gap-4 pt-2">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-2 px-5 py-2 bg-zinc-900 hover:bg-zinc-800 disabled:bg-zinc-400 text-white font-semibold rounded-lg transition-colors"
        >
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        {message && (
          <span className={`text-sm ${message.kind === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>
            {message.text}
          </span>
        )}
      </div>
    </form>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-zinc-700 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-zinc-500 mt-1">{hint}</span>}
    </label>
  )
}
