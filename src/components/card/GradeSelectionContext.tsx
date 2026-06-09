'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'

/** Shares the card page's selected grade ("variant key": 'raw' or
 *  '<company>-<grade>') between the grade ladder (CardMainPanel) and the
 *  Recent Sales section, so picking a grade drives which sales are shown.
 *  Defaults to a no-op so consumers are safe without a provider. */
interface GradeSelection {
  key: string | null
  setKey: (k: string) => void
}

const Ctx = createContext<GradeSelection>({ key: null, setKey: () => {} })

export function GradeSelectionProvider({ children }: { children: ReactNode }) {
  const [key, setKey] = useState<string | null>(null)
  return <Ctx.Provider value={{ key, setKey }}>{children}</Ctx.Provider>
}

export function useGradeSelection() {
  return useContext(Ctx)
}
