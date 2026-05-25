'use client'

import { useEffect, useState } from 'react'

interface Parts {
  done: boolean
  days: number
  hours: number
  minutes: number
  seconds: number
}

function calcParts(target: number): Parts {
  const diff = target - Date.now()
  if (diff <= 0) return { done: true, days: 0, hours: 0, minutes: 0, seconds: 0 }
  const totalSeconds = Math.floor(diff / 1000)
  return {
    done: false,
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  }
}

export function RaffleCountdown({ endsAt }: { endsAt: string }) {
  const target = new Date(endsAt).getTime()
  // Lazy initializer renders something on first paint; the visible
  // span uses suppressHydrationWarning since server-side Date.now()
  // and client-side Date.now() will be off by a second or two and we
  // don't care.
  const [parts, setParts] = useState<Parts>(() => calcParts(target))

  useEffect(() => {
    const id = setInterval(() => setParts(calcParts(target)), 1000)
    return () => clearInterval(id)
  }, [target])

  if (parts.done) {
    return (
      <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/15 backdrop-blur text-white font-semibold">
        <span className="relative flex h-2 w-2">
          <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
        </span>
        Raffle has closed — drawing winner soon
      </div>
    )
  }

  return (
    <div className="flex items-end gap-3 sm:gap-5">
      <Cell value={parts.days} label="Days" />
      <Sep />
      <Cell value={parts.hours} label="Hours" />
      <Sep />
      <Cell value={parts.minutes} label="Min" />
      <Sep />
      <Cell value={parts.seconds} label="Sec" />
    </div>
  )
}

function Cell({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center min-w-[44px] sm:min-w-[56px]">
      <span
        className="text-3xl sm:text-4xl font-bold tabular-nums leading-none drop-shadow-lg"
        suppressHydrationWarning
      >
        {String(value).padStart(2, '0')}
      </span>
      <span className="text-[10px] sm:text-[11px] uppercase tracking-wider text-white/70 mt-1.5">
        {label}
      </span>
    </div>
  )
}

function Sep() {
  return <span className="text-3xl sm:text-4xl font-bold text-white/40 leading-none -translate-y-2">:</span>
}
