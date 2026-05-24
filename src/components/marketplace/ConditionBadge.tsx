import { gradingStyle } from '@/lib/gradingStyle'

/**
 * Compact condition indicator used in card listings + market data.
 *
 * Graded cards render as a pill whose color follows the real holder
 * tier (BL/Pristine = black+gold, BGS 10/9.5 = gold, PSA = red, etc.)
 * via the shared gradingStyle() helper so chip rows and ask tables stay
 * visually in sync.
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
    const style = gradingStyle(gradingCompany, grade);
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-[0.08em] ring-1 ${style.pill}`}
      >
        {style.isCrownJewel && (
          <svg className="w-2.5 h-2.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.539 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
        )}
        {style.shortLabel}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
      NM
    </span>
  );
}
