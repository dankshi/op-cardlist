'use client'

import { useMemo, useState } from 'react'
import {
  buildChips,
  COMPANY_ORDER,
  type ChipData,
  type VariantData,
} from './variantChips'

/** Standalone grade ladder. Lives below the buy box and owns the grade
 *  selection (lifted to the parent via selectedKey/onSelect so the buy box
 *  + market drawer stay in sync). Grouped by company to mirror the PSA/BGS/
 *  CGC population tables further down the page, and — crucially — the
 *  default set of grades is FIXED (it never auto-expands based on the
 *  card's listings), so the ladder reads identically on every card. */
export function GradeSelector({
  variants,
  selectedKey,
  onSelect,
}: {
  variants: VariantData[]
  selectedKey: string
  onSelect: (key: string) => void
}) {
  const chips = useMemo(() => buildChips(variants), [variants])
  const [showAll, setShowAll] = useState(false)

  const rawChip = chips.find(c => c.key === 'raw')!
  // Grades hidden in the default view (everything non-primary). Static count
  // — same on every card — so the toggle label doesn't jump around.
  const hiddenCount = useMemo(
    () => chips.filter(c => c.key !== 'raw' && !c.primary).length,
    [chips],
  )

  const groups = useMemo(() => {
    const isVisible = (c: ChipData) => showAll || c.primary
    return COMPANY_ORDER.map(company => ({
      company,
      chips: chips.filter(c => c.companyKey === company && isVisible(c)),
    })).filter(g => g.chips.length > 0)
  }, [chips, showAll])

  return (
    <section className="mt-8 border-t border-zinc-200 pt-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-bold text-zinc-900">Grades</h2>
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setShowAll(s => !s)}
            className="text-xs font-semibold text-zinc-500 hover:text-zinc-900 transition-colors cursor-pointer"
          >
            {showAll ? 'Show less' : `Show all (${hiddenCount} more)`}
          </button>
        )}
      </div>

      {/* Ungraded leads, then one labelled group per grading company. The
          divider between groups echoes the population tables below. */}
      {/* Each company is its own bordered segmented group with connected
          cells (ALT-style) — the grouping is implied by the container so we
          don't need dividers between companies. */}
      <div className="flex flex-wrap items-start gap-x-4 gap-y-4">
        <GradeGroup label="Raw">
          <GradeTile
            chip={rawChip}
            isActive={rawChip.key === selectedKey}
            onClick={() => onSelect(rawChip.key)}
          />
        </GradeGroup>

        {groups.map(group => (
          <GradeGroup key={group.company} label={group.company}>
            {group.chips.map(c => (
              <GradeTile
                key={c.key}
                chip={c}
                isActive={c.key === selectedKey}
                onClick={() => onSelect(c.key)}
              />
            ))}
          </GradeGroup>
        ))}
      </div>

      <p className="text-xs text-zinc-400 mt-4">
        Tap a grade to load its lowest listing into the buy box above.
      </p>
    </section>
  )
}

/** A labelled segmented group: company name above a single bordered
 *  container of connected grade cells (internal 2px dividers, no gaps). The
 *  container's border + rounding is what visually groups the company, so no
 *  external dividers are needed between companies. */
function GradeGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-2">
        {label}
      </p>
      <div className="inline-flex divide-x-2 divide-zinc-200 rounded-lg border-2 border-zinc-200 overflow-hidden">
        {children}
      </div>
    </div>
  )
}

/** Compact grade tile: plain-text grade on top (no tier color — the company
 *  group header already says PSA/BGS/etc.), lowest price below, pop as a
 *  small caption. Selected tile gets the orange treatment that matches the
 *  buy box's active accent. */
function GradeTile({
  chip,
  isActive,
  onClick,
}: {
  chip: ChipData
  isActive: boolean
  onClick: () => void
}) {
  const hasListing = chip.lowestListingPrice != null
  const isGraded = chip.companyKey !== null
  const gradeText = isGraded ? chip.display : 'NM'

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-shrink-0 w-[80px] px-2 py-2 text-center transition-colors cursor-pointer ${
        isActive
          ? 'bg-orange-50'
          : 'bg-white hover:bg-zinc-50'
      }`}
    >
      {/* Grade — plain text, no slab-label styling. */}
      <div className={`text-sm font-bold tracking-tight ${isActive ? 'text-orange-600' : 'text-zinc-900'}`}>
        {gradeText}
      </div>

      {/* Lowest listing price (or em-dash when none). */}
      <div className="mt-1">
        {hasListing ? (
          <span className={`text-[13px] font-light tabular-nums tracking-tight ${isActive ? 'text-orange-600' : 'text-zinc-900'}`}>
            ${chip.lowestListingPrice!.toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </span>
        ) : (
          <span className="text-[13px] font-light text-zinc-300">—</span>
        )}
      </div>

      {/* Caption row — always rendered so every tile is the same height.
          Graded tiles show pop; the raw tile reserves the line with a
          non-breaking space so it doesn't sit shorter than the rest. */}
      <div className="mt-0.5 text-[9px] uppercase tracking-wider text-zinc-400 tabular-nums">
        {isGraded ? `Pop ${chip.population.toLocaleString()}` : ' '}
      </div>
    </button>
  )
}
