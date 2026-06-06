'use client'

import { useState, useRef, useEffect } from 'react'

export interface AgreementScrollProps {
  onAccept: () => void
  onDecline: () => void
  isSubmitting?: boolean
}

// Full agreement text extracted for scrolling
const FULL_AGREEMENT_TEXT = `BESPOXAI PARTNER AGREEMENT

This Agreement is entered into between BespoxAI Limited ("Provider") and [Partner Name] ("Partner").

SECTION 1: PARTIES AND RELATIONSHIP
The Partner is an independent contractor and not an employee, agent, or representative of BespoxAI, except as expressly stated in this Agreement. The Partner is not authorized to bind BespoxAI to any obligation without prior written consent.

SECTION 2: GRANTED RIGHTS & LICENSE
BespoxAI grants Partner a non-exclusive, non-transferable, revocable license to:
- Resell the Platform to End Customers in the specified Territory
- Use Licensed Materials for sales, marketing, and training purposes
- Deploy and manage the BCAgent PowerShell service on End Customer systems

If Partner opts for white-label model, Partner may rebrand the Platform with Partner's own logo, color scheme, and domain. Despite white-label rights, all client-facing materials must include "Powered by BespoxAI."

SECTION 3: RESTRICTIONS ON USE
Partner shall NOT:
- Sublicense, resell, or permit third parties to use the Platform except as End Customers
- Reverse engineer, decompile, or attempt to derive source code
- Modify, adapt, or create derivative works of the Platform
- Use the Platform for any purpose other than as authorized
- Remove or obscure proprietary notices
- Disclose API keys or security credentials to unauthorized parties
- Use the Platform to process data outside the Territory without consent
- Resell or distribute to parties in excluded territories or industries

SECTION 4: PARTNER OBLIGATIONS & SUPPORT
Partner shall:
- Ensure End Customers have appropriate technical infrastructure
- Provide or coordinate first-line technical support
- Facilitate BCAgent installation following BespoxAI's Installation Guide
- Maintain customer contact information accurate in the Partner Portal
- Attend mandatory quarterly enablement sessions
- Maintain professional marketing materials and not make false claims

SECTION 5: TERRITORY & EXCLUSIVITY
Partner's rights are limited to the Geographic Territory specified. Partnership is non-exclusive unless stated otherwise. BespoxAI retains the right to sell directly to End Customers and appoint other partners in the same territory.

SECTION 6: PRICING, FEES & REVENUE SHARE
Payment terms:
- Partner invoices issued monthly in arrears
- Payment due within 30 days from invoice date
- Late payments accrue interest at the maximum legal rate
- Overdue Accounts: BespoxAI may suspend Platform access after 15 days overdue
- Partner responsible for all taxes, GST, and currency conversion fees

SECTION 7: INTELLECTUAL PROPERTY
BespoxAI retains all IP rights in the Platform, including source code, algorithms, infrastructure, Licensed Materials, documentation, and BCAgent. Partner retains all IP in Partner's own branding and marketing materials.

Partner may not reverse-engineer customizations or extract methodology for reuse with competing platforms. BespoxAI may incorporate customizations into the Platform for all users.

SECTION 8: DATA PROTECTION, PRIVACY & SECURITY
- BespoxAI is the Data Processor; Partner is a Data Controller/Processor for End Customers
- Partner shall maintain appropriate data access logs and audit trails
- Partner shall implement access controls to prevent unauthorized disclosure
- Partner shall notify BespoxAI immediately of any suspected data breach
- Partner shall not share or copy End Customer data without consent
- Partner shall comply with Privacy Act 2020 (NZ) and Privacy Act 1988 (AU)

A separate Data Processing Agreement (DPA) governs data flows, retention, deletion, and breach notification.

SECTION 9: CONFIDENTIALITY
Confidential Information includes pricing structures, API specifications, BCAgent configuration, customer lists, performance metrics, and trade secrets. Each party may disclose to employees and advisors with legitimate need to know, under written confidentiality obligations.

Confidentiality obligations survive termination for 3 years (or longer for trade secrets).

SECTION 10: WARRANTIES & REPRESENTATIONS
BespoxAI warrants:
- Authority to grant the rights in this Agreement
- Platform and Materials do not infringe third-party IP rights
- Platform will substantially conform to published documentation
- Compliance with applicable data protection laws

DISCLAIMER: THE PLATFORM IS PROVIDED "AS IS" WITHOUT WARRANTY OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT. BESPOXAI DOES NOT WARRANT THAT THE PLATFORM WILL BE ERROR-FREE, UNINTERRUPTED, OR THAT ALL ISSUES WILL BE CORRECTED.

Partner warrants:
- Authority to enter this Agreement
- Will not violate third-party IP rights or applicable laws
- Will comply with industry standards for data protection and support
- Will not make false claims about the Platform
- Has appropriate business licenses and insurance

NZ Consumer Guarantees Act Compliance: To the extent the Platform is supplied to consumer End Customers in New Zealand, BespoxAI acknowledges that the Consumer Guarantees Act 1993 applies. BespoxAI shall indemnify Partner for CGA liability claims arising solely from Provider defects.

Australian Consumer Law Compliance: To the extent the Platform is supplied to consumer or small business End Customers in Australia, BespoxAI acknowledges Australian Consumer Law (ACL) consumer guarantees apply. BespoxAI shall indemnify Partner for ACL liability claims arising solely from defects in the Platform.

SECTION 11: LIMITATIONS OF LIABILITY
Except for indemnification obligations, breaches of confidentiality, or IP infringement claims:
- BespoxAI's total liability shall not exceed the fees paid by Partner in the 12 months preceding the claim
- Neither party shall be liable for indirect, incidental, special, consequential, or punitive damages
- Neither party shall be liable for loss of profits, revenue, data, or business opportunity

SECTION 11.4: SECURITY BREACHES AND DATA LOSS – COMPLETE EXCLUSION
Notwithstanding any other provision in this Agreement, BespoxAI shall have NO LIABILITY whatsoever for:
- Any security breach, unauthorized access, or compromised credentials involving the Platform, BCAgent, or any partner-facing systems, regardless of cause or origin
- Any loss, corruption, destruction, or inaccessibility of data while using BCAgent, the Platform, or related services
- Ransomware attacks, malware infections, or cyberattacks affecting Partner's systems or Business Central/NAV databases
- Data exfiltration, encryption, or destruction due to compromised credentials or weak security practices
- Business interruption or regulatory fines arising from Partner's data security practices

Partner is solely responsible for:
- Securing BCAgent installations (Windows server firewall, access controls, antivirus, patching)
- Managing Business Central/NAV credentials and access permissions
- Implementing network security controls and monitoring for unauthorized access
- Maintaining regular backups of all data independent of the Platform
- Notifying BespoxAI immediately of any suspected breach or unauthorized access

This exclusion applies fully even if a breach is discovered to have originated from a defect in the Platform, BCAgent, or BespoxAI infrastructure, as Partner assumes all risk of data security while using partner-facing systems.

SECTION 12: INDEMNIFICATION
BespoxAI shall indemnify Partner from claims that the Platform or Materials infringe third-party IP rights or that BespoxAI's breach causes direct loss to Partner.

Partner shall indemnify BespoxAI from claims arising from Partner's breach, false marketing, negligence, misuse, or End Customer relationships.

SECTION 13: TERM & TERMINATION
Initial Term: 12 months. Auto-renews for successive 12-month periods unless either party provides 90 days' notice of non-renewal.

Termination for Convenience: Either party may terminate without cause by providing 90 days' written notice.

Termination for Cause: Either party may terminate immediately upon written notice if the other party materially breaches and fails to cure within 30 days, becomes insolvent, or violates IP restrictions.

Upon Termination:
- Partner shall cease all use of the Platform
- Partner shall return or destroy Confidential Information
- All unpaid invoices become immediately due
- All API keys and access shall be deactivated
- BespoxAI shall provide 30 days' notice to End Customers
- BespoxAI shall provide export access to End Customer data within 15 days
- Partner shall facilitate handoff of End Customer accounts

SECTION 14: DISPUTE RESOLUTION & GOVERNING LAW
Before initiating formal proceedings, parties shall attempt good-faith negotiation for 30 days. Either party may require mediation, with costs split equally.

Governing Law: This Agreement is governed by the laws of New Zealand or Australia (as specified). Each party consents to the exclusive jurisdiction of courts in that jurisdiction.

SECTION 15: GENERAL PROVISIONS
Entire Agreement: This Agreement supersedes all prior negotiations and understandings.

Amendments: No amendment is effective unless in writing and signed by authorized representatives.

Counterparts: This Agreement may be executed in counterparts (including PDF or DocuSign).

Notices: Notices must be in writing and delivered by hand, email, or certified mail.

Assignment: Neither party may assign without the other's prior written consent, except BespoxAI may assign to an affiliate.

Force Majeure: Neither party is liable for failures due to circumstances beyond reasonable control, provided prompt notice is given and reasonable efforts resume performance.

Severability: If any provision is unenforceable, it shall be reformed minimally or severed, with remaining provisions in full force.

Waiver: No waiver is effective unless in writing; failure to enforce does not constitute waiver.

Headings: Section headings are for convenience only and do not affect interpretation.

SCHEDULES:
Schedule A – Branding Guidelines (if white-label model)
Schedule B – Territory & Exclusivity
Schedule C – Pricing & Fee Structure
Schedule D – Service Level Agreement (SLA)
Schedule E – Data Processing Agreement (DPA)

---

By accepting this agreement, you acknowledge you have read, understood, and agree to be bound by all terms and conditions above. Your use of the BespoxAI Partner Portal constitutes acceptance of these terms.`

export default function AgreementScroll({ onAccept, onDecline, isSubmitting = false }: AgreementScrollProps) {
  const [scrolledToBottom, setScrolledToBottom] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const handleScroll = () => {
    if (!scrollContainerRef.current) return
    
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current
    // Consider "scrolled to bottom" if within 50px of the end
    const isAtBottom = scrollHeight - (scrollTop + clientHeight) < 50
    setScrolledToBottom(isAtBottom)
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '20px',
    }}>
      <div style={{
        background: '#ffffff',
        borderRadius: '8px',
        width: '100%',
        maxWidth: '700px',
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }}>
        {/* Header */}
        <div style={{
          padding: '24px 28px',
          borderBottom: '1px solid #e0e0e0',
          flexShrink: 0,
        }}>
          <h2 style={{
            margin: '0 0 4px',
            fontSize: '20px',
            fontWeight: 700,
            color: '#1a1a1a',
          }}>
            Partner Agreement
          </h2>
          <p style={{
            margin: 0,
            fontSize: '13px',
            color: '#666',
          }}>
            Please scroll through and accept to continue
          </p>
        </div>

        {/* Scrollable content */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '24px 28px',
            fontSize: '13px',
            lineHeight: '1.6',
            color: '#2a2a2a',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            whiteSpace: 'pre-wrap',
            wordWrap: 'break-word',
          }}
        >
          {FULL_AGREEMENT_TEXT}
        </div>

        {/* Footer with buttons */}
        <div style={{
          padding: '20px 28px',
          borderTop: '1px solid #e0e0e0',
          background: '#fafafa',
          display: 'flex',
          gap: '12px',
          flexShrink: 0,
        }}>
          <button
            onClick={onDecline}
            disabled={isSubmitting}
            style={{
              flex: 1,
              padding: '11px 20px',
              borderRadius: '6px',
              border: '1px solid #d0d0d0',
              background: '#ffffff',
              color: '#1a1a1a',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              fontSize: '14px',
              fontWeight: 600,
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s',
              opacity: isSubmitting ? 0.6 : 1,
            }}
            onMouseEnter={(e) => {
              if (!isSubmitting) e.currentTarget.style.background = '#f5f5f5'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#ffffff'
            }}
          >
            Decline
          </button>

          <button
            onClick={onAccept}
            disabled={!scrolledToBottom || isSubmitting}
            style={{
              flex: 1,
              padding: '11px 20px',
              borderRadius: '6px',
              border: 'none',
              background: scrolledToBottom && !isSubmitting ? '#0A5C46' : '#ccc',
              color: '#ffffff',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              fontSize: '14px',
              fontWeight: 600,
              cursor: scrolledToBottom && !isSubmitting ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s',
              opacity: isSubmitting ? 0.7 : 1,
            }}
            onMouseEnter={(e) => {
              if (scrolledToBottom && !isSubmitting) {
                e.currentTarget.style.background = '#084a37'
              }
            }}
            onMouseLeave={(e) => {
              if (scrolledToBottom && !isSubmitting) {
                e.currentTarget.style.background = '#0A5C46'
              }
            }}
          >
            {isSubmitting ? 'Accepting...' : scrolledToBottom ? 'Accept & Continue' : 'Scroll to accept'}
          </button>
        </div>
      </div>
    </div>
  )
}
