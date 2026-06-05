'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import type { BrandingConfig } from '@/lib/branding'
import { DEFAULT_BRANDING } from '@/lib/branding'

const BrandingContext = createContext<BrandingConfig>(DEFAULT_BRANDING)

export function useBranding() {
  return useContext(BrandingContext)
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<BrandingConfig>(DEFAULT_BRANDING)

  useEffect(() => {
    fetch('/api/branding')
      .then(r => r.ok ? r.json() : null)
      .then(b => b && setBranding(b))
      .catch(() => {})
  }, [])

  return (
    <BrandingContext.Provider value={branding}>
      {children}
    </BrandingContext.Provider>
  )
}
