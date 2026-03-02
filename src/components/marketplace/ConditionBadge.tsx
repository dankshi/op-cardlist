export function ConditionBadge({
  gradingCompany,
  grade,
}: {
  condition?: string
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
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold text-green-400 bg-green-400/10">
      NM
    </span>
  )
}
