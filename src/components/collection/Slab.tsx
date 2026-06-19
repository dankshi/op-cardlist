'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'

/** A digitally-constructed graded "slab": a plastic case with a proportional
 *  label bar (grader mark + wordmark left, grade number over grade word + cert
 *  right) and the card inset below — modeled on the real holders' proportions,
 *  texture, colors, and wording.
 *
 *  The grader mark tries a drop-in logo at /public/grading/<company>.png (a
 *  licensed asset you supply) and falls back to a generic monogram — no brand
 *  logo is bundled. Colors + grade wording track each grader. */

interface LabelConfig {
  barClass: string
  brand: string           // mark + wordmark + grade-word color
  cert: string            // cert number color
  gradeNumColor: string
  initial: string
  brandName: string
  gradeWord: string
  gradeNum: string
  hairline: string
}

function labelConfig(company: string, grade: string): LabelConfig {
  const c = company.toUpperCase()
  const isBL = /black\s*label|\bbl\b/i.test(grade)
  const isPristine = /pristine/i.test(grade)
  const num = isBL || isPristine ? '10' : grade

  if (c === 'BGS') {
    const gold = '#caa75a'
    if (isBL) {
      return { barClass: 'bg-[linear-gradient(180deg,#2a2a2c_0%,#0b0b0d_55%,#000_100%)]', brand: gold, cert: gold, gradeNumColor: '#f5ecd6', initial: 'B', brandName: 'BECKETT', gradeWord: 'PRISTINE', gradeNum: num, hairline: 'rgba(202,167,90,0.5)' }
    }
    if (grade === '10' || grade === '9.5') {
      return { barClass: 'bg-[linear-gradient(180deg,#fbe8a6_0%,#e0b54a_55%,#c9952f_100%)]', brand: '#5a3d05', cert: '#6b4c0c', gradeNumColor: '#3d2902', initial: 'B', brandName: 'BECKETT', gradeWord: grade === '10' ? 'PRISTINE' : 'GEM MINT', gradeNum: num, hairline: 'rgba(90,61,5,0.35)' }
    }
    return { barClass: 'bg-[linear-gradient(180deg,#e7e7ea_0%,#c2c2c8_55%,#a6a6ad_100%)]', brand: '#3f3f46', cert: '#52525b', gradeNumColor: '#18181b', initial: 'B', brandName: 'BECKETT', gradeWord: 'MINT', gradeNum: num, hairline: 'rgba(63,63,70,0.3)' }
  }
  if (c === 'PSA') {
    return { barClass: 'bg-[linear-gradient(180deg,#ffffff_0%,#f1f1f3_100%)]', brand: '#b3122b', cert: '#71717a', gradeNumColor: '#b3122b', initial: 'P', brandName: 'PSA', gradeWord: grade === '10' ? 'GEM MT' : grade === '9' ? 'MINT' : 'NM-MT', gradeNum: num, hairline: 'rgba(179,18,43,0.55)' }
  }
  if (c === 'CGC') {
    return { barClass: 'bg-[linear-gradient(180deg,#1e63a8_0%,#0f4c84_55%,#0a3a66_100%)]', brand: '#ffffff', cert: 'rgba(255,255,255,0.8)', gradeNumColor: '#ffe9a8', initial: 'C', brandName: 'CGC', gradeWord: grade === '10' ? 'PRISTINE' : 'GEM MINT', gradeNum: num, hairline: 'rgba(255,233,168,0.5)' }
  }
  return { barClass: 'bg-[linear-gradient(180deg,#26272b_0%,#0c0c0e_100%)]', brand: '#39e0d0', cert: 'rgba(255,255,255,0.75)', gradeNumColor: '#ffffff', initial: 'T', brandName: 'TAG', gradeWord: grade === '10' ? 'GEM MINT' : 'MINT', gradeNum: num, hairline: 'rgba(57,224,208,0.5)' }
}

/** Drop-in grader logo (a licensed asset you place at /public/grading/
 *  <company>.png) with a generic monogram + wordmark fallback. The monogram
 *  shows by default; the logo is only used once it successfully preloads, so a
 *  missing file never flashes a broken image. */
function GraderMark({ company, cfg }: { company: string; cfg: LabelConfig }) {
  const [logoOk, setLogoOk] = useState(false)
  const src = `/grading/${company.toLowerCase()}.png`
  useEffect(() => {
    let live = true
    const img = new window.Image()
    img.onload = () => { if (live) setLogoOk(true) }
    img.src = src
    return () => { live = false }
  }, [src])

  if (logoOk) {
    return (
      <div className="relative flex items-center pl-[5%] pr-[3%]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={cfg.brandName} className="h-[64%] w-auto object-contain" />
      </div>
    )
  }
  return (
    <div className="relative flex items-center gap-[6%] pl-[5%] pr-[3%]">
      <div className="aspect-square h-[58%] rounded-full flex items-center justify-center" style={{ border: `1.5px solid ${cfg.brand}` }}>
        <span className="font-black leading-none text-[9px]" style={{ color: cfg.brand }}>{cfg.initial}</span>
      </div>
      <span className="font-bold tracking-[0.14em] leading-none text-[7px]" style={{ color: cfg.brand }}>{cfg.brandName}</span>
    </div>
  )
}

/**
 * Photoreal slab holders. Each entry is one real grading holder: a transparent
 * PNG (the card window cut out; plastic edges semi-transparent) that overlays
 * the card. `win` is the window rectangle as % of the image — measured from the
 * asset's alpha channel — and `aspect` is the PNG's own width/height ratio.
 *
 * Naming convention (see public/slabs/README.md):
 *   - assets live in /public/slabs/, one PNG per holder design
 *   - filename = "<grader>-<grade>.png", lowercase, e.g.
 *       bgs-black-label.png · bgs-9.5.png · psa-10.png · cgc-10.png · tag-10.png
 *   - the same string keys this map (`slabKey()` derives it from company+grade)
 * To add a holder: drop the PNG in /public/slabs/, then register its window
 * rect here under the matching key.
 */
const SLAB_HOLDERS: Record<string, { aspect: string; win: { left: number; top: number; width: number; height: number } }> = {
  'bgs-black-label': { aspect: '2004 / 3116', win: { left: 13.67, top: 24.23, width: 73.4, height: 65.76 } },
  'bgs-10': { aspect: '2004 / 3116', win: { left: 12.72, top: 24.81, width: 73.5, height: 66.17 } },
}

/** Canonical "<grader>-<grade>" key for a graded line — matches the asset
 *  filename. Named top tiers spell out (Black Label / Pristine); numeric grades
 *  stay as-is ("9.5"). */
function slabKey(company: string, grade: string): string {
  const c = company.toLowerCase()
  const g = /black\s*label|\bbl\b/i.test(grade)
    ? 'black-label'
    : /pristine/i.test(grade)
      ? 'pristine'
      : grade.toLowerCase().trim().replace(/\s+/g, '-')
  return `${c}-${g}`
}

function templateFor(company: string, grade: string) {
  const key = slabKey(company, grade)
  const holder = SLAB_HOLDERS[key]
  return holder ? { ...holder, src: `/slabs/${key}.png` } : null
}

/** Beckett grade word by numeric grade (matches the holder label). */
function bgsGradeWord(grade: string): string {
  if (/pristine/i.test(grade) || grade.trim() === '10') return 'PRISTINE'
  const n = parseFloat(grade)
  if (n === 9.5) return 'GEM MINT'
  if (n === 9) return 'MINT'
  if (n >= 8) return 'NM-MINT'
  if (n >= 7) return 'NEAR MINT'
  if (n >= 6) return 'EX-MINT'
  if (n >= 5) return 'EXCELLENT'
  if (n >= 4) return 'VG-EX'
  return 'GOOD'
}

/** "OP04-064_p1" → "#OP04064" (drop variant suffix + dash, like the label). */
function cardNoLabel(cardId: string): string {
  return `#${cardId.split('_')[0].replace(/-/g, '').toUpperCase()}`
}

export function Slab({
  imageUrl,
  cardName,
  company,
  grade,
  certNumber,
  subgrades,
  setName,
  cardId,
  rarity,
  setYear,
}: {
  imageUrl: string
  cardName: string
  company: string
  grade: string
  certNumber?: string | null
  /** BGS sub-scores `{centering,corners,edges,surface}`. */
  subgrades?: Record<string, number> | null
  setName?: string | null
  cardId?: string | null
  rarity?: string | null
  setYear?: number | null
}) {
  // BGS (non-Black-Label) → the gold holder (/slabs/bgs-gold.png, a full holder
  // with a BLANK gold label), used exactly like the photoreal black-label path:
  // card in the window + holder overlay, PLUS the card's real text overlaid on
  // the gold label band. Text scales with the slab via container units (cqw).
  if (company.toUpperCase() === 'BGS' && !/black\s*label|\bbl\b/i.test(grade)) {
    const win = { left: 12.72, top: 24.81, width: 73.5, height: 66.17 } // same holder window as bgs-10
    const band = { left: 9, top: 5, width: 82, height: 17 }             // gold label area (tweak to match the PNG)
    const num = /pristine/i.test(grade) || grade.trim() === '10' ? '10' : grade
    const sg = subgrades ?? {}
    const sub = (k: string) => (sg[k] != null ? String(sg[k]) : '—')
    const Cell = ({ label, k }: { label: string; k: string }) => (
      <div className="flex items-baseline gap-[5%]"><span>{label}</span><span className="tabular-nums font-black">{sub(k)}</span></div>
    )
    return (
      <div className="relative w-full group-hover:opacity-95 transition-opacity" style={{ aspectRatio: '2004 / 3116', containerType: 'inline-size' }}>
        <div className="absolute overflow-hidden rounded-[3px]" style={{ left: `${win.left}%`, top: `${win.top}%`, width: `${win.width}%`, height: `${win.height}%` }}>
          {imageUrl && <Image src={imageUrl} alt={cardName} fill sizes="(max-width:768px) 50vw, 20vw" className="object-cover" unoptimized />}
        </div>
        <Image src="/slabs/bgs-gold.png" alt="" fill sizes="(max-width:768px) 50vw, 20vw" className="object-contain pointer-events-none select-none" />
        <div className="absolute flex items-stretch text-[#2a2010]" style={{ left: `${band.left}%`, top: `${band.top}%`, width: `${band.width}%`, height: `${band.height}%` }}>
          <div className="flex-1 min-w-0 flex flex-col justify-between">
            <div className="font-extrabold leading-[1.08]" style={{ fontSize: '3cqw' }}>
              <p className="truncate">{setYear ? `${setYear} ` : ''}ONE PIECE</p>
              {setName && <p className="truncate">{setName.toUpperCase()}</p>}
              <p className="truncate">{cardId ? `${cardNoLabel(cardId)} ` : ''}{cardName.toUpperCase()}</p>
              {rarity && <p className="truncate">{rarity.toUpperCase()}</p>}
            </div>
            <div className="grid grid-cols-2 gap-x-[8%] font-bold" style={{ fontSize: '2.9cqw' }}>
              <Cell label="CENTERING" k="centering" />
              <Cell label="CORNERS" k="corners" />
              <Cell label="EDGES" k="edges" />
              <Cell label="SURFACE" k="surface" />
            </div>
          </div>
          <div className="flex flex-col items-end justify-between pl-[3%] flex-shrink-0">
            <span className="font-black leading-[0.8]" style={{ fontSize: '13cqw' }}>{num}</span>
            <div className="text-right leading-tight">
              <p className="font-black tracking-[0.02em]" style={{ fontSize: '2.9cqw' }}>{bgsGradeWord(grade)}</p>
              {certNumber && <p className="font-semibold tabular-nums" style={{ fontSize: '2.7cqw' }}>{certNumber}</p>}
            </div>
          </div>
        </div>
      </div>
    )
  }

  const tpl = templateFor(company, grade)
  if (tpl) {
    // Composite: card sits in the holder's transparent window, the holder PNG
    // (frame + baked label) overlays on top. Natural aspect so it reads like a
    // real slab next to raw cards.
    return (
      <div className="relative w-full group-hover:opacity-95 transition-opacity" style={{ aspectRatio: tpl.aspect }}>
        <div
          className="absolute overflow-hidden rounded-[3px]"
          style={{ left: `${tpl.win.left}%`, top: `${tpl.win.top}%`, width: `${tpl.win.width}%`, height: `${tpl.win.height}%` }}
        >
          {imageUrl && (
            <Image src={imageUrl} alt={cardName} fill sizes="(max-width:768px) 50vw, 20vw" className="object-cover" unoptimized />
          )}
        </div>
        <Image src={tpl.src} alt="" fill sizes="(max-width:768px) 50vw, 20vw" className="object-contain pointer-events-none select-none" />
      </div>
    )
  }

  const cfg = labelConfig(company, grade)

  return (
    <div className="relative w-full aspect-[5/7] rounded-[5px] p-[3.5%] bg-[linear-gradient(160deg,#fafafa_0%,#ececef_45%,#cdced3_100%)] ring-1 ring-zinc-300/80 shadow-sm group-hover:ring-zinc-400 transition-all">
      {/* Plastic-case sheen across the whole holder. */}
      <div className="absolute inset-0 rounded-[5px] bg-[linear-gradient(120deg,rgba(255,255,255,0.55)_0%,transparent_30%,transparent_70%,rgba(255,255,255,0.25)_100%)] pointer-events-none" />

      <div className="relative h-full flex flex-col gap-[2.5%]">
        {/* Label bar — grader mark left, grade stack right (number over word over cert). */}
        <div className={`relative h-[16%] rounded-[3px] overflow-hidden flex items-stretch ${cfg.barClass}`}>
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.18)_0%,transparent_18%,transparent_75%,rgba(0,0,0,0.28)_100%)] pointer-events-none" />
          <div className="absolute bottom-0 inset-x-0 h-[1px]" style={{ background: cfg.hairline }} />

          <GraderMark company={company} cfg={cfg} />

          <div className="flex-1" />

          {/* Grade number, with grade word + cert beneath it. */}
          <div className="relative flex flex-col items-end justify-center pr-[5%] pl-[2%]">
            <span className="font-black tabular-nums leading-none text-[16px]" style={{ color: cfg.gradeNumColor }}>{cfg.gradeNum}</span>
            <span className="font-bold tracking-[0.1em] uppercase leading-none text-[6px] mt-[2px]" style={{ color: cfg.brand }}>{cfg.gradeWord}</span>
            {certNumber && <span className="font-mono leading-none text-[5px] mt-[2px]" style={{ color: cfg.cert }}>{certNumber}</span>}
          </div>
        </div>

        {/* BGS subgrade strip — four sub-scores under the label, like the real holder. */}
        {company.toUpperCase() === 'BGS' && subgrades && (
          <div className={`relative rounded-[3px] overflow-hidden flex items-stretch h-[7%] ${cfg.barClass}`}>
            <div className="absolute bottom-0 inset-x-0 h-[1px]" style={{ background: cfg.hairline }} />
            {([['CEN', 'centering'], ['COR', 'corners'], ['EDG', 'edges'], ['SUR', 'surface']] as const).map(([lab, key], i) => (
              <div key={key} className="flex-1 flex flex-col items-center justify-center" style={i > 0 ? { borderLeft: `1px solid ${cfg.hairline}` } : undefined}>
                <span className="font-bold tracking-[0.04em] leading-none" style={{ fontSize: '4px', color: cfg.brand }}>{lab}</span>
                <span className="font-black tabular-nums leading-none mt-[1px]" style={{ fontSize: '7px', color: cfg.gradeNumColor }}>{subgrades[key] ?? '—'}</span>
              </div>
            ))}
          </div>
        )}

        {/* Card inside the holder */}
        <div className="relative flex-1 rounded-[2px] overflow-hidden bg-zinc-100 ring-1 ring-black/10">
          {imageUrl && (
            <Image src={imageUrl} alt={cardName} fill sizes="(max-width:768px) 50vw, 20vw" className="object-cover" unoptimized />
          )}
        </div>
      </div>
    </div>
  )
}
