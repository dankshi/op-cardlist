import Image from 'next/image'

/** A digitally-constructed graded "slab": a plastic case with a proportional
 *  label bar (emblem + brand wordmark left, grade word + number right) and the
 *  card inset below — modeled on the real holders' proportions, texture, colors,
 *  and wording. The emblem is a generic monogram, not a brand logo; colors and
 *  grade wording track each grader so a slab reads correctly at a glance. */

interface LabelConfig {
  barClass: string        // label background (textured gradient)
  brand: string           // emblem + wordmark + grade-word color
  title: string           // center title color
  gradeNumColor: string   // the big grade number
  initial: string         // monogram letter
  brandName: string
  gradeWord: string
  gradeNum: string
  hairline: string        // thin accent line under the label
}

function labelConfig(company: string, grade: string): LabelConfig {
  const c = company.toUpperCase()
  const isBL = /black\s*label|\bbl\b/i.test(grade)
  const isPristine = /pristine/i.test(grade)
  const num = isBL || isPristine ? '10' : grade

  if (c === 'BGS') {
    const gold = '#caa75a'
    if (isBL) {
      return { barClass: 'bg-[linear-gradient(180deg,#2a2a2c_0%,#0b0b0d_55%,#000_100%)]', brand: gold, title: gold, gradeNumColor: '#f5ecd6', initial: 'B', brandName: 'BECKETT', gradeWord: 'PRISTINE', gradeNum: num, hairline: 'rgba(202,167,90,0.5)' }
    }
    if (grade === '10' || grade === '9.5') {
      return { barClass: 'bg-[linear-gradient(180deg,#fbe8a6_0%,#e0b54a_55%,#c9952f_100%)]', brand: '#5a3d05', title: '#6b4c0c', gradeNumColor: '#3d2902', initial: 'B', brandName: 'BECKETT', gradeWord: grade === '10' ? 'PRISTINE' : 'GEM MINT', gradeNum: num, hairline: 'rgba(90,61,5,0.35)' }
    }
    return { barClass: 'bg-[linear-gradient(180deg,#e7e7ea_0%,#c2c2c8_55%,#a6a6ad_100%)]', brand: '#3f3f46', title: '#52525b', gradeNumColor: '#18181b', initial: 'B', brandName: 'BECKETT', gradeWord: 'MINT', gradeNum: num, hairline: 'rgba(63,63,70,0.3)' }
  }
  if (c === 'PSA') {
    return { barClass: 'bg-[linear-gradient(180deg,#ffffff_0%,#f1f1f3_100%)]', brand: '#b3122b', title: '#3f3f46', gradeNumColor: '#b3122b', initial: 'P', brandName: 'PSA', gradeWord: grade === '10' ? 'GEM MT' : grade === '9' ? 'MINT' : 'NM-MT', gradeNum: num, hairline: 'rgba(179,18,43,0.55)' }
  }
  if (c === 'CGC') {
    return { barClass: 'bg-[linear-gradient(180deg,#1e63a8_0%,#0f4c84_55%,#0a3a66_100%)]', brand: '#ffffff', title: 'rgba(255,255,255,0.85)', gradeNumColor: '#ffe9a8', initial: 'C', brandName: 'CGC', gradeWord: grade === '10' ? 'PRISTINE' : 'GEM MINT', gradeNum: num, hairline: 'rgba(255,233,168,0.5)' }
  }
  // TAG (and any other): dark holographic-leaning label.
  return { barClass: 'bg-[linear-gradient(180deg,#26272b_0%,#0c0c0e_100%)]', brand: '#39e0d0', title: 'rgba(255,255,255,0.8)', gradeNumColor: '#ffffff', initial: 'T', brandName: 'TAG', gradeWord: grade === '10' ? 'GEM MINT' : 'MINT', gradeNum: num, hairline: 'rgba(57,224,208,0.5)' }
}

export function Slab({
  imageUrl,
  cardName,
  company,
  grade,
  cardId,
  serialNumber,
}: {
  imageUrl: string
  cardName: string
  company: string
  grade: string
  cardId?: string
  serialNumber?: string | null
}) {
  const cfg = labelConfig(company, grade)

  return (
    <div className="relative aspect-[5/7] rounded-[5px] p-[3.5%] bg-[linear-gradient(160deg,#fafafa_0%,#ececef_45%,#cdced3_100%)] ring-1 ring-zinc-300/80 shadow-sm group-hover:ring-zinc-400 transition-all">
      {/* Plastic-case sheen across the whole holder. */}
      <div className="absolute inset-0 rounded-[5px] bg-[linear-gradient(120deg,rgba(255,255,255,0.55)_0%,transparent_30%,transparent_70%,rgba(255,255,255,0.25)_100%)] pointer-events-none" />

      <div className="relative h-full flex flex-col gap-[2.5%]">
        {/* Label bar */}
        <div className={`relative h-[15.5%] rounded-[3px] overflow-hidden flex items-stretch ${cfg.barClass}`}>
          {/* texture: top highlight + bottom shade */}
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.18)_0%,transparent_18%,transparent_75%,rgba(0,0,0,0.28)_100%)] pointer-events-none" />
          {/* accent hairline at the bottom edge */}
          <div className="absolute bottom-0 inset-x-0 h-[1px]" style={{ background: cfg.hairline }} />

          {/* Left — emblem + brand wordmark */}
          <div className="relative flex items-center gap-[5%] pl-[5%] pr-[3%]">
            <div className="aspect-square h-[60%] rounded-full flex items-center justify-center" style={{ border: `1.5px solid ${cfg.brand}` }}>
              <span className="font-black leading-none text-[9px]" style={{ color: cfg.brand }}>{cfg.initial}</span>
            </div>
            <span className="font-bold tracking-[0.14em] leading-none text-[7px]" style={{ color: cfg.brand }}>{cfg.brandName}</span>
          </div>

          {/* Center — card title (small, like the real label's title line) */}
          <div className="relative flex-1 flex flex-col justify-center min-w-0 px-[2%] gap-[1px]">
            {cardId && <span className="truncate font-semibold tracking-wide uppercase leading-none text-[6px]" style={{ color: cfg.title }}>{cardId}</span>}
            <span className="truncate uppercase leading-none text-[5px]" style={{ color: cfg.title, opacity: 0.75 }}>{cardName}</span>
          </div>

          {/* Right — grade word over the big number, serial beneath */}
          <div className="relative flex flex-col items-end justify-center pr-[5%] pl-[2%] gap-[1px]">
            <span className="font-bold tracking-[0.1em] uppercase leading-none text-[6px]" style={{ color: cfg.brand }}>{cfg.gradeWord}</span>
            <span className="font-black tabular-nums leading-none text-[15px]" style={{ color: cfg.gradeNumColor }}>{cfg.gradeNum}</span>
            {serialNumber && <span className="font-mono leading-none text-[5px]" style={{ color: cfg.title, opacity: 0.7 }}>{serialNumber}</span>}
          </div>
        </div>

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
