import { CONDITION_SHORT, CONDITION_COLORS, type CardCondition } from '@/types/database'

export function ConditionBadge({ condition }: { condition: CardCondition }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${CONDITION_COLORS[condition]}`}>
      {CONDITION_SHORT[condition]}
    </span>
  )
}
