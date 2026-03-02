import { CONDITION_SHORT, CONDITION_COLORS, type CardCondition } from '@/types/database'

export function ConditionBadge({
  condition,
  gradingCompany,
  grade,
}: {
  condition: CardCondition
  gradingCompany?: string | null
  grade?: string | null
}) {
  if (gradingCompany && grade) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold text-blue-600 bg-blue-500/10">
        {gradingCompany} {grade}
      </span>
    )
  }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${CONDITION_COLORS[condition]}`}>
      {CONDITION_SHORT[condition]}
    </span>
  )
}
