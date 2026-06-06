'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function PartnerAgreementPage() {
  const [activeTab, setActiveTab] = useState<'overview' | 'fulltext'>('overview')

  return (
    <div style={{ minHeight: '100vh', background: '#ffffff', color: '#1a1a1a' }}>
      {/* Header */}
      <div style={{ background: '#f5f5f5', borderBottom: '1px solid #e0e0e0', padding: '40px 20px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <Link href="/" style={{ color: '#0066cc', textDecoration: 'none', fontSize: 14, marginBottom: 16, display: 'block' }}>
            ← Back
          </Link>
          <h1 style={{ margin: '20px 0 8px', fontSize: 36, fontWeight: 700 }}>BespoxAI Partner Agreement</h1>
          <p style={{ margin: '0 0 20px', color: '#666', fontSize: 16 }}>
            Review and download our standard partner agreement for resellers, white-label partners, and managed services providers.
          </p>
        </div>
      </div>

      {/* Main content */}
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 20px' }}>
        
        {/* Download buttons */}
        <div style={{ 
          background: '#f9f9f9', 
          border: '1px solid #e0e0e0', 
          borderRadius: 8, 
          padding: 24, 
          marginBottom: 40,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 16
        }}>
          <a 
            href="/legal/BespoxAI_Partner_Agreement_Signable.pdf" 
            download 
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
              background: '#fff',
              border: '1px solid #d0d0d0',
              borderRadius: 6,
              textDecoration: 'none',
              color: '#1a1a1a',
              transition: 'all 0.2s',
              cursor: 'pointer'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#f0f0f0'
              e.currentTarget.style.borderColor = '#0066cc'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#fff'
              e.currentTarget.style.borderColor = '#d0d0d0'
            }}
          >
            <span style={{ fontSize: 24, marginBottom: 8 }}>📄</span>
            <span style={{ fontWeight: 600, marginBottom: 4 }}>Download PDF</span>
            <span style={{ fontSize: 12, color: '#999' }}>41 KB</span>
          </a>

          <a 
            href="/legal/BespoxAI_Partner_Agreement_Signable.docx" 
            download 
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
              background: '#fff',
              border: '1px solid #d0d0d0',
              borderRadius: 6,
              textDecoration: 'none',
              color: '#1a1a1a',
              transition: 'all 0.2s',
              cursor: 'pointer'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#f0f0f0'
              e.currentTarget.style.borderColor = '#0066cc'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#fff'
              e.currentTarget.style.borderColor = '#d0d0d0'
            }}
          >
            <span style={{ fontSize: 24, marginBottom: 8 }}>📋</span>
            <span style={{ fontWeight: 600, marginBottom: 4 }}>Download Word</span>
            <span style={{ fontSize: 12, color: '#999' }}>(.docx, 9.8 KB)</span>
          </a>
        </div>

        {/* Tabs */}
        <div style={{ borderBottom: '1px solid #e0e0e0', marginBottom: 30 }}>
          <button
            onClick={() => setActiveTab('overview')}
            style={{
              padding: '12px 24px',
              border: 'none',
              background: activeTab === 'overview' ? '#ffffff' : '#f9f9f9',
              borderBottom: activeTab === 'overview' ? '2px solid #0066cc' : '1px solid #e0e0e0',
              color: activeTab === 'overview' ? '#0066cc' : '#666',
              fontWeight: activeTab === 'overview' ? 600 : 400,
              cursor: 'pointer',
              fontSize: 14,
              transition: 'all 0.2s'
            }}
          >
            Key Terms
          </button>
          <button
            onClick={() => setActiveTab('fulltext')}
            style={{
              padding: '12px 24px',
              border: 'none',
              background: activeTab === 'fulltext' ? '#ffffff' : '#f9f9f9',
              borderBottom: activeTab === 'fulltext' ? '2px solid #0066cc' : '1px solid #e0e0e0',
              color: activeTab === 'fulltext' ? '#0066cc' : '#666',
              fontWeight: activeTab === 'fulltext' ? 600 : 400,
              cursor: 'pointer',
              fontSize: 14,
              transition: 'all 0.2s'
            }}
          >
            Full Agreement
          </button>
        </div>

        {/* Overview tab */}
        {activeTab === 'overview' && (
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginTop: 0, marginBottom: 20 }}>Agreement Highlights</h2>
            
            <div style={{ display: 'grid', gap: 24 }}>
              <section>
                <h3 style={{ fontSize: 16, fontWeight: 600, marginTop: 0, marginBottom: 12, color: '#0066cc' }}>Partnership Models</h3>
                <p style={{ color: '#666', lineHeight: 1.6, margin: '0 0 12px' }}>
                  This agreement supports flexible partnership arrangements:
                </p>
                <ul style={{ margin: '0 0 0 20px', color: '#666', lineHeight: 1.8 }}>
                  <li><strong>Reseller:</strong> Purchase at wholesale, resell at your own price</li>
                  <li><strong>White-Label:</strong> Rebrand and resell under your own name</li>
                  <li><strong>Managed Services:</strong> Manage BespoxAI on behalf of shared clients</li>
                  <li><strong>Referral:</strong> Refer customers and earn commission</li>
                </ul>
              </section>

              <section>
                <h3 style={{ fontSize: 16, fontWeight: 600, marginTop: 0, marginBottom: 12, color: '#0066cc' }}>Compliance & Protection</h3>
                <ul style={{ margin: '0 0 0 20px', color: '#666', lineHeight: 1.8 }}>
                  <li><strong>NZ Consumer Guarantees Act:</strong> Full compliance for New Zealand partners</li>
                  <li><strong>Australian Consumer Law:</strong> Full compliance for Australian partners</li>
                  <li><strong>Data Protection:</strong> Privacy Act 2020 (NZ) and Privacy Act 1988 (AU) aligned</li>
                  <li><strong>IP Protection:</strong> Clear IP ownership and usage rights</li>
                </ul>
              </section>

              <section>
                <h3 style={{ fontSize: 16, fontWeight: 600, marginTop: 0, marginBottom: 12, color: '#0066cc' }}>Key Provisions</h3>
                <ul style={{ margin: '0 0 0 20px', color: '#666', lineHeight: 1.8 }}>
                  <li><strong>Territory:</strong> Defined geographic territory for sales rights</li>
                  <li><strong>Service Levels:</strong> Uptime guarantees and support response times</li>
                  <li><strong>Confidentiality:</strong> Protection of sensitive business information</li>
                  <li><strong>Termination:</strong> Clear exit procedures and transition support</li>
                  <li><strong>12-Month Initial Term:</strong> Auto-renews unless either party opts out</li>
                </ul>
              </section>

              <section>
                <h3 style={{ fontSize: 16, fontWeight: 600, marginTop: 0, marginBottom: 12, color: '#0066cc' }}>Customization</h3>
                <p style={{ color: '#666', lineHeight: 1.6, margin: 0 }}>
                  This template agreement includes five customizable schedules for pricing, territory, SLA terms, branding guidelines, and data processing. You and BespoxAI will complete these together during onboarding.
                </p>
              </section>

              <div style={{ 
                background: '#f0f5ff', 
                border: '1px solid #cce0ff', 
                borderRadius: 6, 
                padding: 16,
                marginTop: 20
              }}>
                <p style={{ margin: '0 0 12px', fontWeight: 600, color: '#003d99' }}>✓ Terms of Use</p>
                <p style={{ margin: 0, color: '#666', fontSize: 14, lineHeight: 1.6 }}>
                  By signing up and using the BespoxAI Partner Portal, you agree to the terms in this agreement. You do not need to print, sign, or return a copy — your use of the platform constitutes acceptance.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Full text tab */}
        {activeTab === 'fulltext' && (
          <div>
            <p style={{ color: '#666', marginTop: 0, marginBottom: 20 }}>
              Below is a summary of the agreement sections. Download the full PDF or Word document for complete legal text.
            </p>
            
            <div style={{ 
              background: '#f9f9f9', 
              border: '1px solid #e0e0e0', 
              borderRadius: 6, 
              padding: 24,
              fontSize: 14,
              lineHeight: 1.8,
              color: '#666'
            }}>
              <ol style={{ margin: '0 0 0 20px' }}>
                <li style={{ marginBottom: 12 }}><strong>Parties and Relationship</strong> – Independent contractor status, no partnership</li>
                <li style={{ marginBottom: 12 }}><strong>Granted Rights & License</strong> – Reseller, white-label, and white-label branding rights</li>
                <li style={{ marginBottom: 12 }}><strong>Partner Obligations & Support</strong> – Training, support, and service level requirements</li>
                <li style={{ marginBottom: 12 }}><strong>Territory & Exclusivity</strong> – Geographic territory and exclusivity options</li>
                <li style={{ marginBottom: 12 }}><strong>Pricing, Fees & Revenue Share</strong> – Three pricing models (reseller, referral, managed services)</li>
                <li style={{ marginBottom: 12 }}><strong>Intellectual Property</strong> – IP ownership and protection</li>
                <li style={{ marginBottom: 12 }}><strong>Data Protection, Privacy & Security</strong> – GDPR, Privacy Act compliance, data handling</li>
                <li style={{ marginBottom: 12 }}><strong>Confidentiality</strong> – Protection of sensitive business information</li>
                <li style={{ marginBottom: 12 }}><strong>Warranties & Representations</strong> – Consumer law compliance (NZ CGA, AU ACL)</li>
                <li style={{ marginBottom: 12 }}><strong>Limitations of Liability</strong> – Liability caps and exclusions</li>
                <li style={{ marginBottom: 12 }}><strong>Indemnification</strong> – Cross-indemnities for breaches and IP claims</li>
                <li style={{ marginBottom: 12 }}><strong>Term & Termination</strong> – 12-month initial term, renewal, and exit procedures</li>
                <li style={{ marginBottom: 12 }}><strong>Dispute Resolution & Governing Law</strong> – NZ/AU jurisdiction options</li>
                <li style={{ marginBottom: 12 }}><strong>General Provisions</strong> – Entire agreement, amendments, notices, assignment</li>
                <li><strong>Schedules</strong> – A: Branding, B: Territory, C: Pricing, D: SLA, E: Data Processing</li>
              </ol>
            </div>

            <div style={{ 
              marginTop: 24,
              padding: 16,
              background: '#fff3cd',
              border: '1px solid #ffc107',
              borderRadius: 6,
              color: '#856404'
            }}>
              <p style={{ margin: '0 0 8px', fontWeight: 600 }}>📌 Legal Review Recommended</p>
              <p style={{ margin: 0, fontSize: 14 }}>
                This is a template agreement. Please have it reviewed by a qualified New Zealand or Australian legal advisor before execution.
              </p>
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ 
          marginTop: 60,
          paddingTop: 30,
          borderTop: '1px solid #e0e0e0',
          color: '#999',
          fontSize: 13
        }}>
          <p style={{ margin: 0 }}>
            <strong>Version:</strong> 1.0 (June 2026) | <strong>Jurisdiction:</strong> New Zealand & Australia
          </p>
          <p style={{ margin: '8px 0 0' }}>
            Questions? <a href="mailto:partners@bespoxai.com" style={{ color: '#0066cc', textDecoration: 'none' }}>Contact our partner team</a>
          </p>
        </div>
      </div>
    </div>
  )
}
