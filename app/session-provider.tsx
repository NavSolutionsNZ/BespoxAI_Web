'use client'
import { useEffect } from 'react'
import { SessionProvider as NextAuthSessionProvider, getSession, useSession } from 'next-auth/react'

// Sessions end after a period of inactivity (lib/session-policy.ts). NextAuth
// only refreshes the session on page load and when the tab regains focus, so
// someone working inside one tab would look idle. While the user is clicking,
// typing or scrolling, refresh the session at most every 5 minutes. An open
// tab nobody touches sends nothing, so it does time out. If the refresh finds
// the session has already ended, go to the login page and say why.
const KEEPALIVE_EVERY_MS = 5 * 60 * 1000

function ActivityKeepAlive() {
  const { status } = useSession()

  useEffect(() => {
    if (status !== 'authenticated') return
    let last = Date.now()
    let busy = false

    const onActivity = async () => {
      if (busy || Date.now() - last < KEEPALIVE_EVERY_MS) return
      busy = true
      last = Date.now()
      try {
        const s = await getSession()
        if (!s) window.location.href = '/login?msg=idle'
      } catch { /* network blip — try again on the next activity */ }
      finally { busy = false }
    }

    const events = ['mousedown', 'keydown', 'touchstart', 'scroll']
    events.forEach(e => window.addEventListener(e, onActivity, { passive: true }))
    return () => events.forEach(e => window.removeEventListener(e, onActivity))
  }, [status])

  return null
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextAuthSessionProvider>
      <ActivityKeepAlive />
      {children}
    </NextAuthSessionProvider>
  )
}
