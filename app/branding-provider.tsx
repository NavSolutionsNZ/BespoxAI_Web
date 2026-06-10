'use client'

import { createContext, useContext, useEffect, useState, ReactNode, Suspense } from 'react'
import type { BrandingConfig } from '@/lib/branding'
import { DEFAULT_BRANDING } from '@/lib/branding'

const BrandingContext = createContext<BrandingConfig>(DEFAULT_BRANDING)

export function useBranding() {
  return useContext(BrandingContext)
}

function BrandingLoader({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<BrandingConfig | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    fetch('/api/branding', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(b => {
        setBranding(b || DEFAULT_BRANDING)
        setIsLoading(false)
      })
      .catch(() => {
        setBranding(DEFAULT_BRANDING)
        setIsLoading(false)
      })
  }, [])

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100vh', background: '#ffffff' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 14, color: '#666', fontFamily: 'system-ui' }}>Loading...</div>
        </div>
      </div>
    )
  }

  return (
    <BrandingContext.Provider value={branding || DEFAULT_BRANDING}>
      {children}
    </BrandingContext.Provider>
  )
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <BrandingLoader>{children}</BrandingLoader>
    </Suspense>
  )
}
