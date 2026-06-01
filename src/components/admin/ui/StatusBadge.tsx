import { statusLabel, statusStyle } from '@/lib/admin/orderStatus'

/** Order-status pill driven by the shared status module. */
export function StatusBadge({ status, size = 'sm' }: { status: string; size?: 'sm' | 'md' }) {
  const sizeClass = size === 'md' ? 'text-sm px-3 py-1' : 'text-xs px-2 py-0.5'
  return (
    <span className={`rounded-full font-medium whitespace-nowrap ${sizeClass} ${statusStyle(status)}`}>
      {statusLabel(status)}
    </span>
  )
}
