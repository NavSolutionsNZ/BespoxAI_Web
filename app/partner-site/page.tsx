import Link from 'next/link'

export default function PartnerLandingPage() {
  return (
    <div style={{
      minHeight: '100vh',
      background: '#040E09',
      color: '#F4EFE4',
      fontFamily: 'var(--font-body)',
    }}>

      {/* Nav */}
      <nav style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '20px 48px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, letterSpacing: '0.15em', textTransform: 'uppercase' }}>
          Bespox<span style={{ color: '#C8952A' }}>AI</span>
          <span style={{ marginLeft: 12, fontSize: 10, color: 'rgba(244,239,228,0.4)', letterSpacing: '0.1em' }}>PARTNERS</span>
        </div>
        <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
          <Link href="https://bespoxai.com" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'rgba(244,239,228,0.5)', textDecoration: 'none', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            bespoxai.com
          </Link>
          <Link href="/login" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'rgba(244,239,228,0.7)', textDecoration: 'none', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Sign in
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <div style={{
        maxWidth: 820,
        margin: '0 auto',
        padding: '100px 48px 80px',
        textAlign: 'center',
      }}>
        <div style={{
          display: 'inline-block',
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: '#C8952A',
          border: '1px solid rgba(200,149,42,0.3)',
          padding: '4px 14px',
          borderRadius: 20,
          marginBottom: 32,
        }}>
          Partner Programme
        </div>

        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'clamp(36px, 6vw, 64px)',
          fontWeight: 400,
          lineHeight: 1.1,
          margin: '0 0 28px',
          color: '#F4EFE4',
        }}>
          Grow your NAV and BC practice with BespoxAI
        </h1>

        <p style={{
          fontFamily: 'var(--font-body)',
          fontSize: 'clamp(15px, 2vw, 18px)',
          lineHeight: 1.7,
          color: 'rgba(244,239,228,0.65)',
          maxWidth: 580,
          margin: '0 auto 48px',
        }}>
          Deliver AI-powered ERP intelligence and managed customisation services to your clients — under your brand, on your terms.
        </p>

        <Link href="/signup" style={{
          display: 'inline-block',
          background: '#0A5C46',
          color: '#F4EFE4',
          fontFamily: 'var(--font-body)',
          fontSize: 15,
          fontWeight: 600,
          padding: '14px 36px',
          borderRadius: 8,
          textDecoration: 'none',
          transition: 'background 0.15s',
          letterSpacing: '0.02em',
        }}>
          Get started →
        </Link>
      </div>

      {/* Feature pillars */}
      <div style={{
        maxWidth: 960,
        margin: '0 auto',
        padding: '0 48px 100px',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: 24,
      }}>
        {[
          {
            icon: '◈',
            title: 'Manage all your clients',
            body: 'One portal, every client. Access the full customisation pipeline and AI coding assistant across all your tenants from a single partner login.',
          },
          {
            icon: '◇',
            title: 'Revenue share model',
            body: 'Earn 60% of every pipeline payment collected through BespoxAI — or manage client billing entirely yourself with our partner-collected mode.',
          },
          {
            icon: '⊙',
            title: 'White-label ready',
            body: 'Apply your own branding to the portal. Your clients see your logo and colours, backed by BespoxAI infrastructure.',
          },
          {
            icon: '◎',
            title: 'BCAgent per client',
            body: 'Install and manage BCAgent on each client\'s server from the partner portal. Full tunnel, RDP support, and config sync built in.',
          },
        ].map(f => (
          <div key={f.title} style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 12,
            padding: '28px 28px 24px',
          }}>
            <div style={{ fontSize: 22, marginBottom: 14, color: '#C8952A' }}>{f.icon}</div>
            <h3 style={{ fontFamily: 'var(--font-body)', fontSize: 15, fontWeight: 600, color: '#F4EFE4', margin: '0 0 10px' }}>{f.title}</h3>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'rgba(244,239,228,0.55)', lineHeight: 1.65, margin: 0 }}>{f.body}</p>
          </div>
        ))}
      </div>

      {/* Footer CTA */}
      <div style={{
        borderTop: '1px solid rgba(255,255,255,0.06)',
        padding: '48px',
        textAlign: 'center',
      }}>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'rgba(244,239,228,0.4)', margin: 0 }}>
          Already have an account?{' '}
          <Link href="/login" style={{ color: '#C8952A', textDecoration: 'none' }}>Sign in</Link>
        </p>
      </div>
    </div>
  )
}
