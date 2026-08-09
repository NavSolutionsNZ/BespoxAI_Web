import type { Metadata } from 'next'
import { Cormorant_Garamond, DM_Sans, DM_Mono } from 'next/font/google'
import './globals.css'
import { SessionProvider } from './session-provider'
import { BrandingProvider } from './branding-provider'

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-cormorant',
})

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-dm-sans',
})

const dmMono = DM_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-dm-mono',
})

export const metadata: Metadata = {
  title: 'BespoxAI — Intelligence for NAV & BC',
  description: 'AI-powered feasibility, specs, live financial answers and fixed-price development for Dynamics NAV and Business Central — on the system you own, no migration required.',
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
  },
  verification: {
    google: 'QLEhpW5JT5aJmON6rMAvZImZ49YXzLYgvszpiDRETqM',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${cormorant.variable} ${dmSans.variable} ${dmMono.variable}`}>
      <body>
        <SessionProvider>
          <BrandingProvider>{children}</BrandingProvider>
        </SessionProvider>
      </body>
    </html>
  )
}
