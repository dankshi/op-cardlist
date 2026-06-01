import type { ReactNode } from 'react'

/** Titled card wrapper. Replaces the repeated
 *  `bg-white border border-zinc-200 rounded-lg` + uppercase-label
 *  boilerplate scattered across the admin pages. */
export function Section({
  title,
  count,
  action,
  children,
  className = '',
  bodyClassName = 'p-4',
}: {
  title: string
  count?: number
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={`bg-white border border-zinc-200 rounded-lg overflow-hidden ${className}`}>
      <div className="px-4 py-3 border-b border-zinc-200 flex items-center justify-between gap-3">
        <h2 className="text-xs uppercase tracking-wide text-zinc-500 font-semibold">
          {title}
          {count !== undefined && <span className="ml-1.5 text-zinc-400 font-normal">({count})</span>}
        </h2>
        {action}
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  )
}

/** Muted "nothing here" filler for empty related-record sections. */
export function EmptyHint({ children }: { children: ReactNode }) {
  return <p className="text-sm text-zinc-400">{children}</p>
}
