'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'

type Theme = 'dark' | 'light'

type PartnerThemeCtx = {
  theme: Theme
  setTheme: (t: Theme) => void
  loaded: boolean
}

const Ctx = createContext<PartnerThemeCtx>({ theme: 'dark', setTheme: () => {}, loaded: false })

export function usePartnerTheme() {
  return useContext(Ctx)
}

export function PartnerThemeProvider({ children }: { children: ReactNode }) {
  // Default to dark to preserve the existing partner look until the saved
  // preference loads.
  const [theme, setThemeState] = useState<Theme>('dark')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let active = true
    fetch('/api/partner/account', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!active) return
        const t = d?.partnerTheme === 'light' ? 'light' : 'dark'
        setThemeState(t)
        setLoaded(true)
      })
      .catch(() => { if (active) setLoaded(true) })
    return () => { active = false }
  }, [])

  // Optimistic local update (settings page persists via API separately).
  const setTheme = (t: Theme) => setThemeState(t)

  return (
    <Ctx.Provider value={{ theme, setTheme, loaded }}>
      {children}
    </Ctx.Provider>
  )
}
