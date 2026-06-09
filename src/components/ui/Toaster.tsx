'use client'

import { createContext, useCallback, useContext, useState } from 'react'

type ToastVariant = 'success' | 'error'
interface Toast { id: number; message: string; variant: ToastVariant; href?: string }

const ToastCtx = createContext<{ show: (message: string, opts?: { variant?: ToastVariant; href?: string }) => void } | null>(null)

export function useToast() {
  const ctx = useContext(ToastCtx)
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>')
  return ctx
}

let idSeq = 0

/** Tiny dependency-free toast: bottom-right, auto-dismissing stack. Wrap the
 *  app once and call useToast().show(...) from any client component. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const show = useCallback((message: string, opts?: { variant?: ToastVariant; href?: string }) => {
    const id = ++idSeq
    setToasts(t => [...t, { id, message, variant: opts?.variant ?? 'success', href: opts?.href }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3200)
  }, [])

  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <ToastCard key={t.id} toast={t} onDismiss={() => setToasts(list => list.filter(x => x.id !== t.id))} />
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const accent = toast.variant === 'error' ? 'text-red-500' : 'text-emerald-500'
  const inner = (
    <div className="pointer-events-auto flex items-center gap-2.5 rounded-xl bg-zinc-900 text-white shadow-2xl ring-1 ring-black/10 pl-3 pr-4 py-2.5 max-w-xs animate-toast-in">
      <svg className={`w-4 h-4 flex-shrink-0 ${accent}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        {toast.variant === 'error'
          ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          : <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />}
      </svg>
      <span className="text-sm font-medium leading-tight">{toast.message}</span>
    </div>
  )
  if (toast.href) {
    return <a href={toast.href} onClick={onDismiss}>{inner}</a>
  }
  return <div onClick={onDismiss}>{inner}</div>
}
