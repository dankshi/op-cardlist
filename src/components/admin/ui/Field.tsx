import type { ReactNode } from 'react'
import { CopyButton } from './CopyButton'

type FieldKind = 'text' | 'mono' | 'id' | 'money' | 'date' | 'datetime' | 'bool' | 'json'

/** A single label/value row for the master view. Formats by `kind` and
 *  renders a copy chip for `id`-kind values. `null`/`undefined`/'' show a
 *  muted em-dash so admins can see the column exists but is empty. */
export function Field({
  label,
  value,
  kind = 'text',
  children,
}: {
  label: string
  value?: unknown
  kind?: FieldKind
  children?: ReactNode
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-zinc-400 font-medium">{label}</dt>
      <dd className="mt-0.5 text-sm text-zinc-800 break-words">
        {children !== undefined ? children : <FieldValue value={value} kind={kind} />}
      </dd>
    </div>
  )
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === ''
}

function FieldValue({ value, kind }: { value: unknown; kind: FieldKind }) {
  if (isEmpty(value)) return <span className="text-zinc-300">—</span>

  switch (kind) {
    case 'money':
      return <span className="tabular-nums">${Number(value).toFixed(2)}</span>
    case 'date':
      return <span>{new Date(String(value)).toLocaleDateString()}</span>
    case 'datetime':
      return (
        <span title={String(value)}>
          {new Date(String(value)).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
        </span>
      )
    case 'bool':
      return (
        <span className={value ? 'text-emerald-700 font-medium' : 'text-zinc-500'}>
          {value ? 'true' : 'false'}
        </span>
      )
    case 'json':
      return (
        <pre className="text-xs font-mono bg-zinc-50 border border-zinc-100 rounded px-2 py-1 overflow-x-auto whitespace-pre-wrap">
          {JSON.stringify(value, null, 2)}
        </pre>
      )
    case 'id':
      return (
        <span className="inline-flex items-center gap-1">
          <span className="font-mono text-xs text-zinc-700">{String(value)}</span>
          <CopyButton value={String(value)} />
        </span>
      )
    case 'mono':
      return <span className="font-mono text-xs">{String(value)}</span>
    default:
      return <span>{String(value)}</span>
  }
}

/** Responsive grid of <Field>s — wraps a <dl>. */
export function FieldGrid({ children, cols = 3 }: { children: ReactNode; cols?: 2 | 3 | 4 }) {
  const colClass =
    cols === 2 ? 'sm:grid-cols-2' : cols === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-2 lg:grid-cols-3'
  return <dl className={`grid grid-cols-1 ${colClass} gap-x-6 gap-y-3`}>{children}</dl>
}
