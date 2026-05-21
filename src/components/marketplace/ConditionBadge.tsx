/**
 * Compact condition indicator used in card listings.
 *
 * Graded cards get a dark zinc pill with the grading company + grade
 * (e.g. "PSA 10"). BGS Black Label is detected from the grade string
 * and given a champagne-on-black treatment to mark it as elite.
 *
 * Raw cards (all listed as Near Mint per src/types/database.ts) get a
 * quiet text-only "NM" label so the price stays the focal point.
 */
export function ConditionBadge({
  gradingCompany,
  grade,
}: {
  condition?: string;
  gradingCompany?: string | null;
  grade?: string | null;
}) {
  if (gradingCompany && grade) {
    const isBlackLabel = /black\s*label|\bbl\b/i.test(grade);
    if (isBlackLabel) {
      // Compact Black Label treatment: e.g. "BGS BL" instead of the full grade
      // string. Champagne-on-black to mark it as elite.
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-black text-amber-300 text-[10px] font-semibold uppercase tracking-[0.08em] ring-1 ring-amber-400/40">
          <svg className="w-2.5 h-2.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.539 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
          {gradingCompany} BL
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-zinc-900 text-white text-[10px] font-semibold uppercase tracking-[0.08em]">
        {gradingCompany} {grade}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
      NM
    </span>
  );
}
