'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  cardId: string
}

interface Conflict {
  specId: number
  description: string
  variety: string | null
}

/** Fallback input for the card-centric PSA view: when no auto-suggested
 *  spec is right, paste the PSA spec URL directly. Format expected:
 *    https://www.psacard.com/spec/psa/{spec_id}
 *  Extracts the spec_id, then PATCH /api/admin/pops-psa/[specId].
 *  Handles two error cases visibly:
 *    - Spec not in our DB (404) → suggests running the PSA scrape.
 *    - Card already linked to another spec (409) → shows the conflict and
 *      offers a Force button to steal the link. */
export function PsaSpecManualLink({ cardId }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [url, setUrl] = useState('')
  const [state, setState] = useState<'idle' | 'pending' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<Conflict | null>(null)

  function parseSpecId(input: string): number | null {
    const urlMatch = input.match(/\/spec\/psa\/(\d+)/i)
    if (urlMatch) return parseInt(urlMatch[1], 10)
    const bareMatch = input.trim().match(/^\d+$/)
    if (bareMatch) return parseInt(input.trim(), 10)
    return null
  }

  const specId = parseSpecId(url)

  async function submit(force: boolean) {
    setError(null)
    setConflict(null)
    if (specId == null) {
      setError('Need a PSA spec URL like https://www.psacard.com/spec/psa/12345 — or paste just the spec_id')
      return
    }
    setState('pending')
    try {
      const res = await fetch(`/api/admin/pops-psa/${specId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId, force }),
      })
      if (res.status === 409) {
        const body = await res.json().catch(() => ({}))
        if (body.conflict) {
          setConflict(body.conflict as Conflict)
          setState('idle')
          return
        }
        throw new Error(body.error ?? 'Conflict')
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      setState('done')
      setUrl('')
      startTransition(() => router.refresh())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
      setState('idle')
    }
  }

  return (
    <div className="text-xs border border-dashed border-zinc-300 rounded p-2 bg-zinc-50">
      <div className="text-[10px] text-zinc-500 mb-1">Or paste a PSA spec URL to link directly:</div>
      <div className="flex items-start gap-1">
        <input
          type="text"
          value={url}
          onChange={(e) => { setUrl(e.target.value); setConflict(null); setError(null) }}
          placeholder="https://www.psacard.com/spec/psa/..."
          disabled={state === 'pending'}
          className="flex-1 min-w-0 px-2 py-1 text-[11px] border border-zinc-300 rounded focus:outline-none focus:border-blue-500 disabled:opacity-50"
        />
        <span className="text-[10px] text-zinc-500 self-center w-16 truncate">
          {specId ? `→ spec ${specId}` : url.length > 0 ? 'invalid' : ''}
        </span>
        <button
          type="button"
          onClick={() => submit(false)}
          disabled={state === 'pending' || state === 'done' || specId == null}
          className={`flex-shrink-0 px-2 py-0.5 rounded font-semibold cursor-pointer w-[68px] text-center text-xs ${
            state === 'done'
              ? 'bg-emerald-100 text-emerald-700 border border-emerald-300'
              : 'bg-zinc-700 text-white hover:bg-zinc-800 disabled:opacity-50'
          }`}
        >
          {state === 'pending' ? '...' : state === 'done' ? '✓ Linked' : 'Link'}
        </button>
      </div>
      {conflict && (
        <div className="mt-1 p-1.5 bg-amber-50 border border-amber-200 rounded text-[11px]">
          <div className="text-amber-900">
            This card is already linked to{' '}
            <a
              href={`https://www.psacard.com/spec/psa/${conflict.specId}`}
              target="_blank"
              rel="noreferrer"
              className="font-semibold hover:underline"
            >
              spec {conflict.specId} ({conflict.description}
              {conflict.variety ? ` · ${conflict.variety}` : ''}) ↗
            </a>.
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-amber-800">Move the link to spec {specId} anyway?</span>
            <button
              type="button"
              onClick={() => submit(true)}
              className="px-2 py-0.5 rounded bg-amber-600 text-white font-semibold hover:bg-amber-700 text-[11px]"
            >
              Force move
            </button>
            <button
              type="button"
              onClick={() => setConflict(null)}
              className="text-amber-700 hover:underline text-[11px]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <div className="text-[10px] text-red-600 mt-0.5">{error}</div>}
    </div>
  )
}
