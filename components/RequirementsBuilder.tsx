'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'

// ── Stripe surcharge helpers (mirrors lib/stripe-fees.ts for client-side preview) ──
const STRIPE_DOMESTIC_PCT   = 0.0265
const STRIPE_INTL_PCT       = 0.035
const STRIPE_FIXED_FEE      = 0.30

function calcSurcharge(baseAmount: number, isIntl: boolean) {
  const pct     = isIntl ? STRIPE_INTL_PCT : STRIPE_DOMESTIC_PCT
  const charged = baseAmount / (1 - pct) + STRIPE_FIXED_FEE
  const fee     = charged - baseAmount
  return {
    fee:          Math.round(fee * 100) / 100,
    total:        Math.round(charged * 100) / 100,
    pctLabel:     `${(pct * 100).toFixed(2)}%`,
  }
}

function isIntlCountry(country: string | null | undefined) {
  return (country ?? 'NZ').toUpperCase() !== 'NZ'
}

function getPaymentDueDate(): string {
  const now = new Date()
  const due = new Date(now.getFullYear(), now.getMonth() + 1, 20)
  return due.toLocaleDateString('en-NZ', { dateStyle: 'long' })
}

// ── Business config type (mirrors lib/business-config.ts) ────────────────────

export interface Requirement {
  id: string; tenantId: string; userId: string; title: string; description: string
  bcArea: string; priority: string; aiSpec: string | null; status: string
  quote: string | null; quoteApprovedAt: string | null; consultantNote: string | null
  depositAmount: string | null; depositPaidAt: string | null; balancePaidAt: string | null
  depositStripeSessionId: string | null; balanceStripeSessionId: string | null
  adminQuestions: string | null; customerAnswers: string | null; adminQALog: string | null
  quoteRejectedAt: string | null; quoteRejectionReason: string | null
  feasibility: string | null; feasibilityNotes: string | null
  feasibilityCostRange: string | null; feasibilityCheckedAt: string | null
  reviewPaidAt: string | null; reviewStripeSessionId: string | null
  reviewBypassed: boolean; reviewIncluded: boolean; reviewSubmittedAt: string | null
  // Pipeline transition timestamps
  submittedAt: string | null; inReviewAt: string | null; quotedAt: string | null
  depositRequiredAt: string | null; inDevelopmentAt: string | null; completePendingPaymentAt: string | null
  // Deployment & UAT
  testDeployedAt: string | null; testDeploySnapshotId: string | null
  uatApprovedAt: string | null; uatApprovedById: string | null
  uatRejectedAt: string | null; uatRejectionReason: string | null
  uatRejectionAnalysis: any | null
  // Production deployment
  prodApprovalSentAt: string | null
  prodGoLiveDoc: string | null
  prodApprovedAt: string | null
  prodApprovedById: string | null
  prodDeployedAt: string | null
  prodDeploySnapshotId: string | null
  createdAt: string; updatedAt: string
  user: { name: string | null; email: string }
  tenant: { name: string; country: string | null; paymentTermsKey: string | null }
  parentId: string | null
  addenda: { id: string; title: string; status: string; quote: string | null; createdAt: string; parentId: string }[]
}
type CollapseMap = {[key:string]:boolean}

interface AiSpec {
  userStory: string; acceptanceCriteria: string[]; bcObjects: string[]
  complexity: 'Simple'|'Medium'|'Complex'; estimatedDays: number
  assumptions: string[]; questions: string[]; notes: string
  _changeSummary?: string
  _genCount?: number
  _history?: Array<{ at: string; trigger: string; summary: string; snapshot: any }>
}

interface QAPair { q: string; a: string }

const BC_AREAS = ['Sales','Purchase','Finance','Inventory','Manufacturing','Project','HR','Fixed Assets','Warehouse','Service','Other']
const PRIORITIES = [
  { value:'nice_to_have', label:'Nice to have', color:'#3B5249', bg:'rgba(59,82,73,0.08)',   border:'rgba(59,82,73,0.2)'   },
  { value:'important',    label:'Important',    color:'#C8952A', bg:'rgba(200,149,42,0.08)', border:'rgba(200,149,42,0.25)' },
  { value:'critical',     label:'Critical',     color:'#A32D2D', bg:'rgba(163,45,45,0.06)',  border:'rgba(163,45,45,0.2)'  },
]
const STATUS_PIPELINE = [
  {key:'draft',label:'Draft'},{key:'submitted',label:'Submitted'},
  {key:'in_review',label:'In Review'},{key:'quoted',label:'Quoted'},
  {key:'deposit_required',label:'Deposit Required'},{key:'deposit_paid',label:'Deposit Paid'},
  {key:'in_development',label:'In Development'},{key:'in_uat',label:'In UAT'},
  {key:'uat_confirmed',label:'UAT Confirmed'},{key:'complete_pending_payment',label:'Balance Due'},
  {key:'fully_paid',label:'Complete'},
]
const STATUS_COLOR: Record<string,{bg:string;border:string;text:string}> = {
  draft:                    {bg:'rgba(59,82,73,0.06)',   border:'rgba(59,82,73,0.15)',   text:'#3B5249'},
  submitted:                {bg:'rgba(200,149,42,0.08)', border:'rgba(200,149,42,0.25)', text:'#C8952A'},
  needs_clarification:      {bg:'rgba(200,60,60,0.1)',   border:'rgba(200,60,60,0.35)',  text:'#A32D2D'},
  in_review:                {bg:'rgba(200,149,42,0.12)', border:'rgba(200,149,42,0.35)', text:'#9A6A00'},
  quoted:                   {bg:'rgba(10,92,70,0.08)',   border:'rgba(10,92,70,0.2)',    text:'#0A5C46'},
  quote_rejected:           {bg:'rgba(163,45,45,0.14)', border:'rgba(163,45,45,0.45)',  text:'#8B1A1A'},
  deposit_required:         {bg:'rgba(200,149,42,0.12)',border:'rgba(200,149,42,0.4)',   text:'#7A5200'},
  deposit_paid:             {bg:'rgba(26,146,114,0.1)',  border:'rgba(26,146,114,0.3)', text:'#0F6E56'},
  in_development:           {bg:'rgba(14,110,86,0.1)',   border:'rgba(14,110,86,0.25)', text:'#0A5C46'},
  in_uat:                   {bg:'rgba(200,149,42,0.12)', border:'rgba(200,149,42,0.4)', text:'#7A5200'},
  uat_confirmed:            {bg:'rgba(26,146,114,0.12)', border:'rgba(26,146,114,0.35)',text:'#0A5240'},
  uat_rejected:             {bg:'rgba(163,45,45,0.14)',  border:'rgba(163,45,45,0.45)', text:'#8B1A1A'},
  complete_pending_payment: {bg:'rgba(200,149,42,0.1)',  border:'rgba(200,149,42,0.3)', text:'#7A5200'},
  fully_paid:               {bg:'rgba(26,146,114,0.12)', border:'rgba(26,146,114,0.35)',text:'#0A5240'},
  rejected:                 {bg:'rgba(163,45,45,0.14)', border:'rgba(163,45,45,0.45)',  text:'#8B1A1A'},
}
function statusLabel(s:string) {
  const map:Record<string,string> = {
    needs_clarification:'Needs Clarification', quote_rejected:'Quote Rejected',
    deposit_required:'Deposit Required', deposit_paid:'Deposit Paid',
    in_development:'In Development', in_uat:'In UAT',
    uat_confirmed:'UAT Confirmed ✓', uat_rejected:'UAT Rejected',
    complete_pending_payment:'Balance Due',
    fully_paid:'Complete ✓',
  }
  return map[s] ?? STATUS_PIPELINE.find(p=>p.key===s)?.label ?? s.replace(/_/g,' ')
}
function priorityMeta(p:string) { return PRIORITIES.find(x=>x.value===p)??PRIORITIES[0] }
function parseSpec(req:Requirement):AiSpec|null { try { return req.aiSpec?JSON.parse(req.aiSpec):null } catch { return null } }
function getGenCount(req:Requirement):number { try { return req.aiSpec?JSON.parse(req.aiSpec)._genCount??0:0 } catch { return 0 } }
const MAX_GENS = 4

// Parse customerAnswers — could be JSON [{q,a}] or plain text
function parseAnswers(raw:string|null): QAPair[]|string|null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed[0]?.q !== undefined) return parsed as QAPair[]
  } catch { /* plain text */ }
  return raw
}

interface Props {
  userRole:string
  tenantId:string
  bcConnected?:boolean
  erpLabel?:string
  paymentSuccess?: 'deposit' | 'review' | 'balance' | null
  onPaymentSuccessDismiss?: () => void
}

// ── Business config type (mirrors lib/business-config.ts) ────────────────────
interface BizConfig {
  companyName:string;gstNumber:string|null;email:string;phone:string|null
  website:string;address:string|null;bankName:string|null;bankAccount:string|null
  bankAccountName:string|null;invoiceFooter:string
  terms1Label:string;terms1Text:string;terms2Label:string;terms2Text:string
  terms3Label:string;terms3Text:string
}

const GST_RATE = 0.15

function requiresDeposit(k:string|null|undefined){ return k !== 'terms3' }
function isMonthlyBilling(k:string|null|undefined){ return k === 'terms2' || k === 'terms3' }
function getTermsText(cfg:BizConfig, k:string|null|undefined){
  if (k === 'terms2') return cfg.terms2Text
  if (k === 'terms3') return cfg.terms3Text
  return cfg.terms1Text
}

// ── Markdown renderer for light/cream backgrounds (consultant notes) ──────────
function mdInlineLight(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i} style={{ fontWeight: 600, color: 'var(--ink)' }}>{part.slice(2, -2)}</strong>
      : part
  )
}

function renderMdLight(text: string): React.ReactNode {
  const lines = text.split('\n')
  return lines.map((line, i) => {
    if (/^#{1,2} /.test(line))
      return <p key={i} style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink)', margin: '10px 0 2px', lineHeight: 1.3 }}>{mdInlineLight(line.replace(/^#+ /, ''))}</p>
    if (/^### /.test(line))
      return <p key={i} style={{ fontWeight: 600, fontSize: 12, color: 'var(--ink)', margin: '8px 0 2px', lineHeight: 1.3 }}>{mdInlineLight(line.slice(4))}</p>
    if (line === '---')
      return <hr key={i} style={{ border: 'none', borderTop: '1px solid var(--fog)', margin: '8px 0' }} />
    if (/^[-–] /.test(line))
      return <div key={i} style={{ display: 'flex', gap: 6, margin: '2px 0', alignItems: 'flex-start', paddingLeft: 20 }}><span style={{ color: 'var(--forest)', flexShrink: 0, marginTop: 1 }}>–</span><span style={{ lineHeight: 1.6, color: 'var(--ink)' }}>{mdInlineLight(line.replace(/^[-–] /, ''))}</span></div>
    if (/^\d+\. /.test(line)) {
      const num = line.match(/^(\d+)/)?.[1]
      return <div key={i} style={{ display: 'flex', gap: 8, margin: '4px 0 1px', alignItems: 'baseline' }}><span style={{ color: 'var(--forest)', flexShrink: 0, minWidth: 16, fontWeight: 600, textAlign: 'right' }}>{num}.</span><span style={{ lineHeight: 1.5, color: 'var(--ink)', fontWeight: 600 }}>{mdInlineLight(line.replace(/^\d+\.\s/, ''))}</span></div>
    }
    if (line === '') return <div key={i} style={{ height: 4 }} />
    return <p key={i} style={{ margin: '2px 0', lineHeight: 1.7, color: 'var(--ink)' }}>{mdInlineLight(line)}</p>
  })
}

const CARD_OPEN_FOR: { [key: string]: string[] } = {
  desc:    ['draft','needs_clarification','quote_rejected'],
  spec:    ['draft','submitted','needs_clarification','quote_rejected','in_review'],
  feasib:  ['submitted','needs_clarification','in_review'],
  quote:   ['quoted','deposit_required','complete_pending_payment','fully_paid'],
  uat:     ['in_uat','uat_confirmed','uat_rejected'],
  proddep: ['uat_confirmed','complete_pending_payment','fully_paid'],
  addenda: [],
}

function isCardCollapsedFn(id: string, reqs: Requirement[], map: CollapseMap): boolean {
  if (id in map) return map[id]
  const dash   = id.lastIndexOf('-')
  const prefix = id.slice(0, dash)
  const reqId  = id.slice(dash + 1)
  const req    = reqs.find((r) => r.id === reqId)
  const st     = req?.status ?? 'draft'
  return !(CARD_OPEN_FOR[prefix] ?? []).includes(st)
}

function CardToggleBtn({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', color: 'var(--slate)', fontSize: 13, lineHeight: 1, display: 'flex', alignItems: 'center' }} title={collapsed ? 'Expand' : 'Collapse'}>
      {collapsed ? '▾' : '▴'}
    </button>
  )
}

export default function RequirementsBuilder({ userRole, tenantId, bcConnected=false, erpLabel='BC', paymentSuccess, onPaymentSuccessDismiss }:Props) {
  const isSuperadmin = userRole === 'superadmin'
  const router = useRouter()
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const [reqs, setReqs]             = useState<Requirement[]>([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState('')
  const [selected, setSelected]     = useState<Requirement|null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [filterStatus, setFS]       = useState('all')
  const [filterArea, setFA]         = useState('all')
  const [bizConfig, setBizConfig]   = useState<BizConfig|null>(null)

  // Sync selected requirement from URL — handles back/forward + deep links
  useEffect(() => {
    const reqId = searchParams.get('req')
    if (!reqId) { setSelected(null); return }
    if (reqs.length > 0) {
      const target = reqs.find(r => r.id === reqId)
      if (target) setSelected(target)
    }
  }, [searchParams, reqs])

  useEffect(() => {
    fetch('/api/business-config').then(r=>r.json()).then(d=>{ if(!d.error) setBizConfig(d) }).catch(()=>{})
  }, [])

  const [form, setForm]     = useState({title:'',description:'',bcArea:'Finance',priority:'important'})
  const [saving, setSaving] = useState(false)
  const [formErr, setFE]    = useState('')

  const [genSpec, setGen]     = useState(false)
  const [specErr, setSpecErr] = useState('')
  // Per-question answer state: { [questionIndex]: answerText }
  const [qaAnswers, setQAAnswers]   = useState<Record<number,string>>({})
  const [showQAPanel, setShowQAP]   = useState(false)
  // Refinement panel — customer edits to drive next regeneration
  const [showRefine, setShowRefine]         = useState(false)
  const [refinementText, setRefinementText] = useState('')
  const [editedUserStory, setEditedUS]      = useState('')
  const [editedCriteria, setEditedCrit]     = useState<string[]>([])

  const [actLoading, setAL]       = useState(false)
  const [showQF, setShowQF]       = useState(false)
  // Addendum — full page flow (same as create, linked to parent)
  const [showAddendum, setShowAddendum]         = useState(false)
  const [addendumParentId, setAddendumParentId] = useState<string|null>(null)
  const [addendumParentTitle, setAddendumParentTitle] = useState('')
  const [addendumForm, setAddendumForm] = useState({title:'',description:'',bcArea:'Finance',priority:'important'})
  const [addendumSaving, setAddendumSaving]     = useState(false)
  const [addendumErr, setAddendumErr]           = useState('')
  // UAT sign-off / rejection
  const [showUATReject, setShowUATReject]     = useState(false)
  const [uatRejectReason, setUATRejectReason] = useState('')
  const [uatRejectLoading, setUATRejectLoad]  = useState(false)
  const [uatScopeCreep, setUATScopeCreep]     = useState<{explanation:string;suggestedAmendment?:string}|null>(null)
  const [uatApproveLoading, setUATApproveLoad] = useState(false)
  const [quoteAmt, setQA]         = useState('')
  const [quoteNote, setQN]        = useState('')

  const [showSendBack, setShowSB] = useState(false)
  const [sendBackText, setSBT]    = useState('')

  const [adminAnswerDraft, setAAD] = useState('')
  const [objFiles, setObjFiles]     = useState<any[]>([])
  const [objUploading, setObjUpload] = useState(false)
  const objInputRef = useRef<HTMLInputElement>(null)

  // Quote rejection state
  const [showRejectQuote, setShowRQ]     = useState(false)
  const [rejectReason, setRejectReason]  = useState('')

  // Resubmit after quote rejection — editable fields seeded from requirement
  const [resubmitForm, setRF] = useState({title:'',description:'',bcArea:'Finance',priority:'important',extraContext:''})

  const [feasLoadingId, setFeasLoadingId] = useState<string|null>(null)
  const [feasErr, setFeasErr]             = useState('')
  const [reviewAllowance, setReviewAllowance] = useState<{included:number;used:number;remaining:number}|null>(null)
  const [reviewLoading, setReviewLoading]     = useState(false)
  const [collapsedCards, setCC] = useState<CollapseMap>({})
  function isCardCollapsed(id: string, map?: typeof collapsedCards) {
    return isCardCollapsedFn(id, reqs, map ?? collapsedCards)
  }
  function toggleCard(key: string) { setCC(prev => ({ ...prev, [key]: !isCardCollapsedFn(key, reqs, prev) })) }

  // Accept quote / payment modal — covers deposit (quoted) and balance (complete_pending_payment)
  const [showPayModal, setShowPayModal]       = useState(false)
  const [payingReq, setPayingReq]             = useState<Requirement|null>(null)
  const [payFlow, setPayFlow]                 = useState<'deposit'|'balance'>('deposit')
  const [paymentMode, setPaymentMode]         = useState<'stripe'|'invoice'|null>(null)
  const [poNumber, setPoNumber]               = useState('')
  const [payLoading, setPayLoading]           = useState(false)
  const [reviewPoReq, setReviewPoReq]         = useState<Requirement|null>(null)
  const [reviewPo, setReviewPo]               = useState('')
  // Keep old names as aliases so nothing else breaks
  const showAcceptModal = showPayModal
  const acceptingReq    = payingReq

  // ── Payment success banner ───────────────────────────────────────────────────
  const [bannerVisible, setBannerVisible] = useState(false)
  useEffect(() => {
    if (paymentSuccess) {
      setBannerVisible(true)
      const t = setTimeout(() => { setBannerVisible(false); onPaymentSuccessDismiss?.() }, 8000)
      return () => clearTimeout(t)
    }
  }, [paymentSuccess])

  async function load() {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/requirements')
      const d   = await res.json()
      if (!res.ok) throw new Error(d.error)
      setReqs(d.requirements)
    } catch(e:any) { setError(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])
  useEffect(() => {
    if (!isSuperadmin) {
      fetch('/api/billing/review-allowance')
        .then(r => r.json())
        .then(d => { if (d.included !== undefined) setReviewAllowance(d) })
        .catch(() => {})
    }
  }, [isSuperadmin])

  useEffect(() => {
    if (isSuperadmin && selected?.status === 'fully_paid') {
      fetch(`/api/requirements/${selected.id}/objects`)
        .then(r => r.json())
        .then(d => setObjFiles(d.objects ?? []))
        .catch(() => {})
    } else {
      setObjFiles([])
    }
  }, [selected?.id, selected?.status, isSuperadmin])

  function selectReq(req:Requirement) {
    const s = req.status
    const open = [] as string[]
    if (['draft','submitted','needs_clarification','in_review','quote_rejected','rejected'].includes(s)) open.push('desc-'+req.id)
    if (['draft','submitted','needs_clarification','in_review','quote_rejected','in_development'].includes(s)) open.push('spec-'+req.id)
    if (['submitted','needs_clarification','in_review','quote_rejected'].includes(s)) open.push('feasib-'+req.id)
    if (['quoted','deposit_required','deposit_paid','complete_pending_payment','fully_paid'].includes(s)) open.push('quote-'+req.id)
    if (['in_uat','uat_rejected','uat_confirmed'].includes(s)) open.push('uat-'+req.id)
    if (['uat_confirmed','complete_pending_payment','fully_paid'].includes(s)) open.push('proddep-'+req.id)
    if (['deposit_required','deposit_paid','in_development','complete_pending_payment','fully_paid'].includes(s)) open.push('documents-'+req.id)
    const init = Object.fromEntries(open.map(k => [k, false]))
    setCC(init)
    setSelected(req); setShowCreate(false)
    setShowQAP(false); setQAAnswers({})
    setShowRefine(false); setRefinementText(''); setEditedUS(''); setEditedCrit([])
    setAAD(''); setShowSB(false); setShowQF(false)
    setSpecErr(''); setFeasErr(''); setShowRQ(false); setRejectReason('')
    setRF({title:req.title,description:req.description,bcArea:req.bcArea,priority:req.priority,extraContext:''})
    const params = new URLSearchParams(searchParams.toString())
    params.set('req', req.id)
    router.push(pathname + '?' + params.toString(), { scroll: false })
  }

  function clearReq() {
    setSelected(null)
    const params = new URLSearchParams(searchParams.toString())
    params.delete('req')
    router.push(pathname + '?' + params.toString(), { scroll: false })
  }

  function formatCostRange(r: string | null): string {
    if (!r) return ''
    const map: Record<string,string> = { '2-5k': '$2–5k NZD', '5-15k': '$5–15k NZD', '15k+': '$15k+ NZD' }
    return map[r] ?? r
  }

  async function runFeasibility(req: Requirement) {
    setFeasLoadingId(req.id); setFeasErr('')
    try {
      const res = await fetch(`/api/requirements/${req.id}/feasibility`, { method: 'POST' })
      const d   = await res.json()
      if (!res.ok) throw new Error(d.error)
      setReqs(prev => prev.map(r => r.id === req.id ? d.requirement : r))
      setSelected(d.requirement)
    } catch (e: any) { setFeasErr(e.message) }
    finally { setFeasLoadingId(null) }
  }

  async function submitForReview(req: Requirement) {
    setReviewLoading(true)
    try {
      const res = await fetch(`/api/requirements/${req.id}/submit-for-review`, { method: 'POST' })
      const d   = await res.json()
      if (!res.ok) throw new Error(d.error)
      if (d.checkoutUrl) {
        window.location.href = d.checkoutUrl
      } else {
        setReqs(prev => prev.map(r => r.id === req.id ? d.requirement : r))
        setSelected(d.requirement)
        // Refresh allowance count
        fetch('/api/billing/review-allowance')
          .then(r => r.json())
          .then(d => { if (d.included !== undefined) setReviewAllowance(d) })
          .catch(() => {})
      }
    } catch (e: any) { alert(e.message) }
    finally { setReviewLoading(false) }
  }

  async function createReq() {
    if (!form.title.trim()||!form.description.trim()) { setFE('Title and description are required.'); return }
    setSaving(true); setFE('')
    try {
      const res = await fetch('/api/requirements',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)})
      const d   = await res.json()
      if (!res.ok) throw new Error(d.error)
      setReqs(prev=>[d.requirement,...prev])
      selectReq(d.requirement)
      setShowCreate(false)
      setForm({title:'',description:'',bcArea:'Finance',priority:'important'})
      // Run feasibility check immediately — determines if development is actually needed
      runFeasibility(d.requirement)
    } catch(e:any) { setFE(e.message) }
    finally { setSaving(false) }
  }

  async function submitAddendum() {
    if (!addendumParentId) return
    const { title, description, bcArea, priority } = addendumForm
    if (!title.trim() || !description.trim()) { setAddendumErr('Title and description are required'); return }
    setAddendumSaving(true); setAddendumErr('')
    try {
      const res = await fetch(`/api/requirements/${addendumParentId}/addendum`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), description: description.trim(), bcArea, priority }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      // Add to flat list and to parent's addenda array
      setReqs(prev => {
        const updated = prev.map(r => r.id === addendumParentId
          ? { ...r, addenda: [...(r.addenda ?? []), { id: d.requirement.id, title: d.requirement.title, status: d.requirement.status, quote: d.requirement.quote, createdAt: d.requirement.createdAt, parentId: addendumParentId }] }
          : r
        )
        return [d.requirement, ...updated]
      })
      setShowAddendum(false)
      setAddendumParentId(null)
      setAddendumParentTitle('')
      setAddendumForm({ title: '', description: '', bcArea: 'Finance', priority: 'important' })
      selectReq(d.requirement)
      // Run feasibility immediately — same as new requirement
      runFeasibility(d.requirement)
    } catch (e: any) { setAddendumErr(e.message ?? 'Failed to submit addendum') }
    finally { setAddendumSaving(false) }
  }

  async function patch(id:string, body:object) {
    setAL(true)
    try {
      const res = await fetch(`/api/requirements/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
      const d   = await res.json()
      if (!res.ok) throw new Error(d.error)
      setReqs(prev=>prev.map(r=>r.id===id?d.requirement:r))
      if (selected?.id===id) setSelected(d.requirement)
    } catch(e:any) { alert(e.message) }
    finally { setAL(false) }
  }

  async function deleteReq(id:string) {
    if (!confirm('Delete this draft requirement?')) return
    const res = await fetch(`/api/requirements/${id}`,{method:'DELETE'})
    if (!res.ok) { alert('Delete failed'); return }
    setReqs(prev=>prev.filter(r=>r.id!==id))
    if (selected?.id===id) clearReq()
  }

  async function generateSpec(
    req: Requirement,
    qaStructured?: QAPair[],
    refinements?: { text?: string; userStory?: string; criteria?: string[] }
  ) {
    setGen(true); setSpecErr('')
    try {
      const body: any = {}
      if (qaStructured && qaStructured.length > 0) {
        body.qaStructured    = qaStructured
        body.customerAnswers = qaStructured.map((p,i)=>`${i+1}. ${p.a}`).join('\n')
      }
      if (refinements?.text)     body.customerRefinements = refinements.text
      if (refinements?.userStory) body.editedUserStory    = refinements.userStory
      if (refinements?.criteria?.length) body.editedCriteria = refinements.criteria
      const res = await fetch(`/api/requirements/${req.id}/ai-spec`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
      const d   = await res.json()
      if (res.status === 429) { setSpecErr(d.error); setGen(false); return }
      if (res.status === 402) { setSpecErr(d.error); setGen(false); return }
      if (!res.ok) throw new Error(d.error)
      setReqs(prev=>prev.map(r=>r.id===req.id?d.requirement:r))
      setSelected(d.requirement)
      setShowQAP(false); setQAAnswers({})
      setShowRefine(false); setRefinementText(''); setEditedUS(''); setEditedCrit([])
    } catch(e:any) { setSpecErr(e.message) }
    finally { setGen(false) }
  }

  async function sendBack() {
    if (!selected||!sendBackText.trim()) return
    await patch(selected.id,{status:'needs_clarification',adminQuestions:sendBackText.trim()})
    setShowSB(false); setSBT('')
  }

  async function submitQuote() {
    if (!selected) return
    await patch(selected.id,{status:'quoted',quote:quoteAmt,consultantNote:quoteNote||undefined})
    setShowQF(false); setQA(''); setQN('')
  }

  async function rejectQuote() {
    if (!selected||!rejectReason.trim()) return
    await patch(selected.id,{status:'quote_rejected',quoteRejectionReason:rejectReason.trim()})
    setShowRQ(false); setRejectReason('')
  }

  async function uploadObjects(reqId: string, files: FileList) {
    setObjUpload(true)
    try {
      const fd = new FormData()
      for (let i = 0; i < files.length; i++) fd.append('files', files[i])
      const res = await fetch(`/api/requirements/${reqId}/objects`, { method: 'POST', body: fd })
      const d = await res.json()
      if (res.ok) setObjFiles(d.objects ?? [])
      else alert(d.error ?? 'Upload failed')
    } catch (e: any) { alert(e.message) }
    finally { setObjUpload(false) }
  }

  async function deleteObjFile(reqId: string, fileId: string) {
    if (!confirm('Remove this object record?')) return
    const res = await fetch(`/api/requirements/${reqId}/objects/${fileId}`, { method: 'DELETE' })
    if (res.ok) setObjFiles(prev => prev.filter((f: any) => f.id !== fileId))
    else alert('Delete failed')
  }

  const filtered = reqs.filter(r=>{
    if (r.parentId) return false   // addenda are navigated via parent — not shown in main list
    if (filterStatus!=='all'&&r.status!==filterStatus) return false
    if (filterArea!=='all'&&r.bcArea!==filterArea) return false
    return true
  })
  const needsClarifCount = reqs.filter(r=>r.status==='needs_clarification').length
  const quoteRejCount    = reqs.filter(r=>r.status==='quote_rejected').length
  const panelOpen = selected||showCreate||showAddendum

  const iSt:React.CSSProperties = {width:'100%',background:'var(--cream)',border:'1px solid var(--fog)',borderRadius:8,padding:'9px 12px',fontSize:13,fontFamily:'var(--font-body)',color:'var(--ink)',outline:'none',boxSizing:'border-box'}
  const fo = (e:any) => e.target.style.borderColor='var(--forest)'
  const bl = (e:any) => e.target.style.borderColor='var(--fog)'


  // ── Payment handlers ────────────────────────────────────────────────────

  function openDepositModal(req: Requirement) {
    setPayingReq(req); setPayFlow('deposit')
    setPaymentMode(null); setPoNumber(''); setShowPayModal(true)
  }

  function openBalanceModal(req: Requirement) {
    setPayingReq(req); setPayFlow('balance')
    setPaymentMode(null); setPoNumber(''); setShowPayModal(true)
  }

  function closePayModal() {
    setShowPayModal(false); setPayingReq(null)
    setPaymentMode(null); setPoNumber('')
  }

  async function handleStripePayment(req: Requirement, withSurcharge: boolean) {
    setPayLoading(true)
    try {
      const endpoint = payFlow === 'deposit'
        ? `/api/requirements/${req.id}/pay-deposit`
        : `/api/requirements/${req.id}/pay-balance`
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ withSurcharge }),
      })
      const d = await res.json()
      if (!res.ok) { alert(d.error ?? 'Failed to create payment session'); return }
      // Terms 3 deposit — auto-advanced, no payment needed
      if (d.autoAdvanced) { closePayModal(); await load(); return }
      if (!d.checkoutUrl) { alert(d.error ?? 'No checkout URL returned'); return }
      window.location.href = d.checkoutUrl
    } catch { alert('Network error — please try again') }
    finally { setPayLoading(false) }
  }

  async function handleInvoiceDownload(req: Requirement, po: string) {
    setPayLoading(true)
    try {
      const quoteNum   = parseFloat(req.quote!)
      const isDeposit  = payFlow === 'deposit'
      const depositAmt = (quoteNum * 0.2).toFixed(2)
      const balanceAmt = (quoteNum - parseFloat(req.depositAmount ?? '0')).toFixed(2)
      const amt        = isDeposit ? depositAmt : balanceAmt
      if (isDeposit) {
        await patch(req.id, {
          status: 'deposit_required',
          quoteApprovedAt: new Date().toISOString(),
          depositAmount: depositAmt,
          ...(po ? { poNumber: po } : {}),
        })
      }
      generateInvoicePDF(req, po, amt, isDeposit, 'bank_transfer', null)
      closePayModal()
      await load()
    } catch { alert('Error generating invoice') }
    finally { setPayLoading(false) }
  }

  function generateInvoicePDF(
    req: Requirement,
    po: string,
    amtStr: string,
    isDeposit: boolean = true,
    paymentMethod: 'stripe' | 'bank_transfer' = 'bank_transfer',
    paidAt?: string | null
  ) {
    const biz           = bizConfig
    const companyName   = biz?.companyName   ?? 'Nav Solutions NZ'
    const gstNumber     = biz?.gstNumber     ?? null
    const bizEmail      = biz?.email         ?? 'auckland@bespoxai.com'
    const bizWebsite    = biz?.website       ?? 'bespoxai.com'
    const bizAddress    = biz?.address       ?? ''
    const bankName      = biz?.bankName      ?? ''
    const bankAccount   = biz?.bankAccount   ?? ''
    const bankAccName   = biz?.bankAccountName ?? ''
    const footer        = biz?.invoiceFooter ?? 'Thank you for choosing BespoxAI'

    // Terms text
    const termsKey      = req.tenant.paymentTermsKey ?? 'terms1'
    let   termsText     = biz?.terms1Text ?? '20% deposit on acceptance; 80% on delivery'
    if (termsKey === 'terms2') termsText = biz?.terms2Text ?? '20% deposit on acceptance; balance due 20th of following month'
    if (termsKey === 'terms3') termsText = biz?.terms3Text ?? 'Full amount due 20th of the following month'

    const monthly       = isMonthlyBilling(termsKey)
    const dueDate       = monthly ? getPaymentDueDate() : null

    const invoiceNum    = `BX-${new Date().getFullYear()}-${req.id.slice(0, 6).toUpperCase()}`
    const dateStr       = new Date().toLocaleDateString('en-NZ', { dateStyle: 'long' })
    const quote         = parseFloat(req.quote ?? '0')
    const hasReviewCredit = isDeposit && !!(req.reviewPaidAt)
    const reviewCredit  = hasReviewCredit ? 249 : 0
    // amtStr is passed in — for deposit invoices it should already reflect the credit
    // but we recalculate here to be safe
    const paymentAmt    = isDeposit
      ? Math.max(0, Math.round((quote * 0.2 - reviewCredit) * 100) / 100)
      : parseFloat(amtStr)
    const gstAmt        = Math.round(paymentAmt * 0.15 * 100) / 100
    const totalInclGST  = Math.round((paymentAmt + gstAmt) * 100) / 100
    const depositPd     = isDeposit ? paymentAmt : parseFloat(req.depositAmount ?? '0')
    const balanceExcl   = quote - (isDeposit ? quote * 0.2 : depositPd)

    const invoiceTitle  = isDeposit ? (monthly ? 'Amount Due' : '20% Deposit — Due Now') : 'Balance — Due Now'
    const dueLine       = dueDate ? `Payment due: ${dueDate}` : (isDeposit ? '' : 'Due on completion')

    // Payment instruction
    const refStr        = `<strong>${invoiceNum}</strong>${po ? ` and PO <strong>${po.replace(/</g,'&lt;')}</strong>` : ''}`
    let paymentNote = ''
    if (paymentMethod === 'stripe' && paidAt) {
      const paidDate = new Date(paidAt).toLocaleDateString('en-NZ', { dateStyle: 'long' })
      paymentNote = `This invoice was paid by card on <strong>${paidDate}</strong>. Thank you — ${isDeposit ? 'development scheduling is underway.' : 'your customisation will be delivered shortly.'}`
    } else if (paymentMethod === 'bank_transfer') {
      const bankDetails = (bankName || bankAccount) ? `<br><br>Bank: <strong>${bankName}</strong><br>Account Name: <strong>${bankAccName}</strong><br>Account Number: <strong>${bankAccount}</strong>` : ''
      if (isDeposit) {
        paymentNote = `Please pay by bank transfer, referencing ${refStr} on your payment.${bankDetails}<br><br>Email <strong>${bizEmail}</strong> to confirm receipt and we will begin development scheduling.${hasReviewCredit ? ' Your $249 specification review fee has been credited against the project total.' : ''}`
      } else {
        const duePart = dueDate ? ` by <strong>${dueDate}</strong>` : ''
        paymentNote = `Please arrange payment${duePart}, referencing ${refStr} on your transfer.${bankDetails}<br><br>Email <strong>${bizEmail}</strong> to confirm — delivery of your customisation will follow.`
      }
    }

    const w = window.open('', '_blank')!
    w.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Invoice ${invoiceNum} — ${companyName}</title>
  <meta charset="UTF-8"/>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Georgia,serif;color:#040E09;padding:48px;max-width:760px;margin:0 auto;font-size:14px}
    .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:36px;padding-bottom:20px;border-bottom:2px solid #0A5C46}
    .logo{font-size:26px;font-weight:700;color:#040E09;letter-spacing:-0.5px}
    .logo-ai{color:#C8952A;font-family:monospace;font-size:17px;letter-spacing:0.04em}
    .tagline{font-size:10px;color:#3B5249;font-style:italic;margin-top:4px}
    .company-details{font-size:11px;color:#3B5249;line-height:1.8;text-align:right}
    h1{font-size:38px;font-weight:300;color:#0A5C46;margin-bottom:28px;font-family:Georgia,serif}
    .meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-bottom:32px}
    .meta-label{font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:#3B5249;margin-bottom:6px;font-family:monospace}
    .meta-value{font-size:13px;color:#040E09;line-height:1.6}
    .section-label{font-size:9px;letter-spacing:0.18em;text-transform:uppercase;color:#3B5249;font-family:monospace;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #D6D9D4}
    .service-block{margin-bottom:28px}
    .service-name{font-size:16px;font-weight:600;color:#040E09;margin-bottom:5px}
    .service-desc{font-size:12px;color:#3B5249;line-height:1.65;font-style:italic;margin-top:4px}
    .totals{margin-bottom:20px}
    .row{display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid #EDE8DC;font-size:13px;align-items:center}
    .row .lbl{color:#3B5249}
    .row .amt{font-family:monospace;color:#040E09}
    .row.credit .amt{color:#0A5C46}
    .row.gst{background:rgba(10,92,70,0.03)}
    .row.total{border-bottom:none;font-weight:600}
    .amount-due{display:flex;justify-content:space-between;align-items:center;background:rgba(10,92,70,0.06);border:1px solid rgba(10,92,70,0.2);border-radius:10px;padding:14px 18px;margin:16px 0 28px}
    .amount-due .lbl{font-size:13px;font-weight:600;color:#040E09}
    .amount-due .amt{font-family:monospace;font-size:22px;font-weight:700;color:#0A5C46}
    .amount-due .due{font-size:10px;color:#7A5200;font-family:monospace;margin-top:4px}
    .note{background:#F4EFE4;border-left:3px solid #0A5C46;padding:12px 16px;font-size:12px;color:#3B5249;line-height:1.7;margin-bottom:32px;border-radius:0 8px 8px 0}
    .paid-stamp{display:inline-block;border:2px solid #0A5C46;color:#0A5C46;font-family:monospace;font-size:11px;letter-spacing:0.15em;padding:3px 10px;border-radius:4px;transform:rotate(-2deg);margin-bottom:8px}
    .footer{padding-top:20px;border-top:1px solid #D6D9D4;display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#3B5249}
    @media print{body{padding:24px}@page{margin:1.5cm}}
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo">Bespox<span class="logo-ai">AI</span></div>
      <div class="tagline">Your Business Central. One portal. Complete control.</div>
    </div>
    <div class="company-details">
      <strong>${companyName}</strong><br>
      ${bizAddress ? bizAddress.replace(/\n/g,'<br>') + '<br>' : ''}
      ${bizEmail}<br>
      ${bizWebsite}
      ${gstNumber ? '<br>GST No: ' + gstNumber : ''}
    </div>
  </div>

  <h1>Invoice</h1>

  <div class="meta-grid">
    <div>
      <div class="meta-label">Invoice To</div>
      <div class="meta-value">
        <strong>${req.tenant.name.replace(/</g,'&lt;')}</strong><br>
        ${req.user.name ? req.user.name.replace(/</g,'&lt;') + '<br>' : ''}
        <span style="font-size:11px;color:#3B5249">${req.user.email}</span>
      </div>
    </div>
    <div>
      <div class="meta-label">Invoice Details</div>
      <div class="meta-value" style="font-size:12px;line-height:1.85">
        <strong>Invoice No:</strong>&nbsp; ${invoiceNum}<br>
        <strong>Date:</strong>&nbsp; ${dateStr}<br>
        ${po ? `<strong>PO / Reference:</strong>&nbsp; ${po.replace(/</g,'&lt;')}<br>` : ''}
        <strong>Terms:</strong>&nbsp; ${termsText}
      </div>
    </div>
  </div>

  <div class="service-block">
    <div class="section-label">Services</div>
    <div class="service-name">${req.title.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
    <div class="service-desc">Business Central area: ${req.bcArea}</div>
    ${req.consultantNote ? `<div class="service-desc" style="margin-top:6px">${req.consultantNote.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>` : ''}
  </div>

  <div class="totals">
    <div class="section-label">Payment Schedule</div>

    ${isDeposit ? `
    <div class="row"><span class="lbl">Total project quote (plus GST)</span><span class="amt">$${quote.toLocaleString('en-NZ',{minimumFractionDigits:2})} NZD</span></div>
    <div class="row subdued"><span class="lbl">80% balance — due ${monthly ? 'on invoice (20th of following month)' : 'on completion'}</span><span class="amt" style="color:#3B5249">$${balanceExcl.toLocaleString('en-NZ',{minimumFractionDigits:2})} NZD</span></div>
    <div class="row" style="border-top:2px solid #EDE8DC;margin-top:4px;padding-top:10px"><span class="lbl">20% deposit</span><span class="amt">$${(quote*0.2).toLocaleString('en-NZ',{minimumFractionDigits:2})} NZD</span></div>
    ${hasReviewCredit ? `<div class="row credit"><span class="lbl">Less: Specification review fee (credited)</span><span class="amt credit">− $249.00 NZD</span></div>` : ''}
    <div class="row"><span class="lbl">Net deposit (plus GST)</span><span class="amt">$${paymentAmt.toLocaleString('en-NZ',{minimumFractionDigits:2})} NZD</span></div>
    <div class="row gst"><span class="lbl">GST (15%)</span><span class="amt">$${gstAmt.toLocaleString('en-NZ',{minimumFractionDigits:2})} NZD</span></div>
    <div class="row total"><span class="lbl">Total deposit due (incl. GST)</span><span class="amt" style="font-size:15px;color:#0A5C46">$${totalInclGST.toLocaleString('en-NZ',{minimumFractionDigits:2})} NZD</span></div>
    ` : `
    <div class="row"><span class="lbl">Total project quote (plus GST)</span><span class="amt">$${quote.toLocaleString('en-NZ',{minimumFractionDigits:2})} NZD</span></div>
    <div class="row subdued"><span class="lbl">Less: 20% deposit already paid</span><span class="amt" style="color:#3B5249">− $${depositPd.toLocaleString('en-NZ',{minimumFractionDigits:2})} NZD</span></div>
    <div class="row" style="border-top:2px solid #EDE8DC;margin-top:4px;padding-top:10px"><span class="lbl">Balance (plus GST)</span><span class="amt">$${paymentAmt.toLocaleString('en-NZ',{minimumFractionDigits:2})} NZD</span></div>
    <div class="row gst"><span class="lbl">GST (15%)</span><span class="amt">$${gstAmt.toLocaleString('en-NZ',{minimumFractionDigits:2})} NZD</span></div>
    <div class="row total"><span class="lbl">Total balance due (incl. GST)</span><span class="amt" style="font-size:15px;color:#0A5C46">$${totalInclGST.toLocaleString('en-NZ',{minimumFractionDigits:2})} NZD</span></div>
    `}
  </div>

  <div class="amount-due">
    <div>
      ${paymentMethod === 'stripe' ? '<div class="paid-stamp">PAID</div><br>' : ''}
      <div class="lbl">${invoiceTitle}</div>
      ${dueLine ? `<div class="due">${dueLine}</div>` : ''}
    </div>
    <div class="amt">$${totalInclGST.toLocaleString('en-NZ',{minimumFractionDigits:2})} NZD</div>
  </div>

  ${paymentMethod === 'bank_transfer' && (bankName || bankAccount) ? `
  <div class="bank-block">
    <div class="section-label" style="margin-bottom:10px">Bank Transfer Details</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
      <div><div class="bank-lbl">Bank</div><div class="bank-val">${bankName || '—'}</div></div>
      <div><div class="bank-lbl">Account Name</div><div class="bank-val">${bankAccName || '—'}</div></div>
      <div><div class="bank-lbl">Account Number</div><div class="bank-val">${bankAccount || '—'}</div></div>
    </div>
  </div>` : paymentMethod === 'bank_transfer' ? `
  <div class="bank-block">
    <p style="font-size:12px;color:#3B5249">Please contact <strong>${bizEmail}</strong> for bank transfer details.</p>
  </div>` : ''}

  <div class="note">${paymentNote}</div>

  <div class="footer">
    <span style="font-style:italic">${footer}</span>
    <span style="font-family:monospace">${gstNumber ? `GST No: ${gstNumber} · ` : ''}${bizWebsite}</span>
  </div>
</body>
</html>`)
    w.document.close()
    setTimeout(() => { w.focus(); w.print() }, 450)
  }

  function generateReviewInvoicePDF(req: Requirement, po: string = '') {
    const biz            = bizConfig
    const companyName    = biz?.companyName    ?? 'Nav Solutions NZ'
    const gstNumber      = biz?.gstNumber      ?? null
    const bizEmail       = biz?.email          ?? 'auckland@bespoxai.com'
    const bizWebsite     = biz?.website        ?? 'bespoxai.com'
    const bizAddress     = biz?.address        ?? ''
    const footer         = biz?.invoiceFooter  ?? 'Thank you for choosing BespoxAI'

    const invoiceNum     = `BX-REV-${new Date().getFullYear()}-${req.id.slice(0, 6).toUpperCase()}`
    const dateStr        = new Date(req.reviewPaidAt!).toLocaleDateString('en-NZ', { dateStyle: 'long' })
    const feeExcl        = 249
    const gstAmt         = Math.round(feeExcl * 0.15 * 100) / 100
    const totalInclGST   = feeExcl + gstAmt

    const w = window.open('', '_blank')!
    w.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Invoice ${invoiceNum} — ${companyName}</title>
  <meta charset="UTF-8"/>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Georgia,serif;color:#040E09;padding:48px;max-width:760px;margin:0 auto;font-size:14px}
    .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:36px;padding-bottom:20px;border-bottom:2px solid #0A5C46}
    .logo{font-size:26px;font-weight:700;color:#040E09;letter-spacing:-0.5px}
    .logo-ai{color:#C8952A;font-family:monospace;font-size:17px;letter-spacing:0.04em}
    .tagline{font-size:10px;color:#3B5249;font-style:italic;margin-top:4px}
    .company-details{font-size:11px;color:#3B5249;line-height:1.8;text-align:right}
    h1{font-size:38px;font-weight:300;color:#0A5C46;margin-bottom:28px}
    .meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-bottom:32px}
    .meta-label{font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:#3B5249;margin-bottom:6px;font-family:monospace}
    .meta-value{font-size:13px;color:#040E09;line-height:1.6}
    .section-label{font-size:9px;letter-spacing:0.18em;text-transform:uppercase;color:#3B5249;font-family:monospace;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #D6D9D4}
    .service-block{margin-bottom:28px}
    .service-name{font-size:16px;font-weight:600;color:#040E09;margin-bottom:5px}
    .service-desc{font-size:12px;color:#3B5249;line-height:1.65;font-style:italic;margin-top:4px}
    .row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #EDE8DC;font-size:13px;align-items:baseline}
    .row .lbl{color:#3B5249;flex:1;padding-right:16px}
    .row .amt{font-family:monospace;color:#040E09;white-space:nowrap}
    .row.subdued .lbl{color:#8A9E96;font-size:12px}
    .row.subdued .amt{color:#8A9E96;font-size:12px}
    .row.credit .lbl{color:#0A5C46}
    .row.credit .amt{color:#0A5C46 !important}
    .row.gst{background:rgba(10,92,70,0.03)}
    .row.total{border-bottom:none;font-weight:600;padding-top:10px}
    .bank-block{background:#F4EFE4;border-radius:8px;padding:14px 16px;margin:16px 0}
    .bank-lbl{font-size:9px;letter-spacing:0.12em;text-transform:uppercase;color:#3B5249;font-family:monospace;margin-bottom:3px}
    .bank-val{font-size:13px;font-weight:600;color:#040E09}
    .amount-due{display:flex;justify-content:space-between;align-items:center;background:rgba(10,92,70,0.06);border:1px solid rgba(10,92,70,0.2);border-radius:10px;padding:14px 18px;margin:16px 0 28px}
    .amount-due .lbl{font-size:13px;font-weight:600;color:#040E09}
    .amount-due .amt{font-family:monospace;font-size:22px;font-weight:700;color:#0A5C46}
    .paid-stamp{display:inline-block;border:2px solid #0A5C46;color:#0A5C46;font-family:monospace;font-size:11px;letter-spacing:0.15em;padding:3px 10px;border-radius:4px;transform:rotate(-2deg);margin-bottom:8px}
    .note{background:#F4EFE4;border-left:3px solid #0A5C46;padding:12px 16px;font-size:12px;color:#3B5249;line-height:1.7;margin-bottom:32px;border-radius:0 8px 8px 0}
    .credit-note{background:rgba(10,92,70,0.04);border:1px solid rgba(10,92,70,0.15);border-radius:8px;padding:10px 14px;font-size:12px;color:#0A5C46;line-height:1.6;margin-bottom:28px}
    .footer{padding-top:20px;border-top:1px solid #D6D9D4;display:flex;justify-content:space-between;font-size:11px;color:#3B5249}
    @media print{body{padding:24px}@page{margin:1.5cm}}
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo">Bespox<span class="logo-ai">AI</span></div>
      <div class="tagline">Your Business Central. One portal. Complete control.</div>
    </div>
    <div class="company-details">
      <strong>${companyName}</strong><br>
      ${bizAddress ? bizAddress.replace(/\n/g,'<br>') + '<br>' : ''}
      ${bizEmail}<br>${bizWebsite}
      ${gstNumber ? '<br>GST No: ' + gstNumber : ''}
    </div>
  </div>

  <h1>Invoice</h1>

  <div class="meta-grid">
    <div>
      <div class="meta-label">Invoice To</div>
      <div class="meta-value">
        <strong>${req.tenant.name.replace(/</g,'&lt;')}</strong><br>
        ${req.user.name ? req.user.name.replace(/</g,'&lt;') + '<br>' : ''}
        <span style="font-size:11px;color:#3B5249">${req.user.email}</span>
      </div>
    </div>
    <div>
      <div class="meta-label">Invoice Details</div>
      <div class="meta-value" style="font-size:12px;line-height:1.85">
        <strong>Invoice No:</strong>&nbsp; ${invoiceNum}<br>
        <strong>Date:</strong>&nbsp; ${dateStr}<br>
        ${po ? `<strong>PO / Reference:</strong>&nbsp; ${po.replace(/</g,'&lt;')}<br>` : ''}
        <strong>Type:</strong>&nbsp; Specification Review Fee
      </div>
    </div>
  </div>

  <div class="service-block">
    <div class="section-label">Services</div>
    <div class="service-name">Senior BC Developer Specification Review</div>
    <div class="service-desc">${req.title.replace(/</g,'&lt;')}</div>
    <div class="service-desc" style="margin-top:6px">Business Central area: ${req.bcArea}</div>
  </div>

  <div style="margin-bottom:20px">
    <div class="section-label">Payment</div>
    <div class="row"><span class="lbl">Specification review fee (plus GST)</span><span class="amt">$${feeExcl.toFixed(2)} NZD</span></div>
    <div class="row gst"><span class="lbl">GST (15%)</span><span class="amt">$${gstAmt.toFixed(2)} NZD</span></div>
    <div class="row total"><span class="lbl">Total incl. GST</span><span class="amt" style="font-size:15px;color:#0A5C46">$${totalInclGST.toFixed(2)} NZD</span></div>
  </div>

  <div class="amount-due">
    <div>
      <div class="paid-stamp">PAID</div><br>
      <div class="lbl">Specification Review Fee</div>
    </div>
    <div class="amt">$${totalInclGST.toFixed(2)} NZD</div>
  </div>

  <div class="credit-note">
    ✦ This $${feeExcl.toFixed(2)} NZD (plus GST) review fee will be credited in full against your development deposit if you proceed with this customisation.
  </div>

  <div class="note">
    Paid by card on ${dateStr}. Thank you — your specification is now in review with our senior BC development team.
    We will be in touch with a quote and development plan.
  </div>

  <div class="footer">
    <span style="font-style:italic">${footer}</span>
    <span style="font-family:monospace">${bizWebsite}</span>
  </div>
</body>
</html>`)
    w.document.close()
    setTimeout(() => { w.focus(); w.print() }, 450)
  }
  if (error)   return <div style={{padding:40,textAlign:'center'}}><p style={{color:'#A32D2D',fontFamily:'var(--font-body)',fontSize:13,marginBottom:10}}>{error}</p><button onClick={load} style={sBTN}>Retry</button></div>

  // ── Banner config ─────────────────────────────────────────────────────────
  const BANNER_CONFIG = {
    review: {
      icon: '🔍',
      title: 'Review request received — thank you!',
      body: "Our senior developer will review your requirements and get back to you with a quote. The $249 review fee will be credited against your development deposit.",
      color: '#0A5C46',
      bg: 'rgba(10,92,70,0.06)',
      border: 'rgba(10,92,70,0.2)',
    },
    deposit: {
      icon: '✅',
      title: 'Deposit confirmed — development is underway!',
      body: "Your deposit has been received and your project is now in the development queue. We'll keep you updated as work progresses.",
      color: '#0F6E56',
      bg: 'rgba(26,146,114,0.07)',
      border: 'rgba(26,146,114,0.25)',
    },
    balance: {
      icon: '🎉',
      title: 'Final payment received — project complete!',
      body: "Thank you for your payment. Your customisation is fully paid and complete. Download your balance invoice from the requirement below.",
      color: '#0A5C46',
      bg: 'rgba(10,92,70,0.06)',
      border: 'rgba(10,92,70,0.2)',
    },
  }

  return (
    <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>

      {/* ── Payment success banner ─────────────────────────────────────────── */}
      {bannerVisible && paymentSuccess && (() => {
        const cfg = BANNER_CONFIG[paymentSuccess]
        return (
          <div style={{
            display:'flex',alignItems:'flex-start',gap:12,
            padding:'14px 20px',
            background: cfg.bg,
            borderBottom: `1px solid ${cfg.border}`,
            flexShrink: 0,
          }}>
            <span style={{fontSize:20,lineHeight:'1.4'}}>{cfg.icon}</span>
            <div style={{flex:1}}>
              <div style={{fontFamily:'var(--font-body)',fontWeight:600,fontSize:14,color:cfg.color,marginBottom:2}}>{cfg.title}</div>
              <div style={{fontFamily:'var(--font-body)',fontSize:13,color:'var(--ink)',opacity:0.8,lineHeight:'1.5'}}>{cfg.body}</div>
            </div>
            <button
              onClick={()=>{ setBannerVisible(false); onPaymentSuccessDismiss?.() }}
              style={{background:'none',border:'none',cursor:'pointer',color:cfg.color,fontSize:18,lineHeight:1,padding:'0 4px',opacity:0.7,flexShrink:0}}
              aria-label="Dismiss"
            >×</button>
          </div>
        )
      })()}

      <div style={{flex:1,display:'flex',overflow:'hidden'}}>

      {/* ── Left list ─────────────────────────────────────────────────────── */}
      <div style={{width:'100%',flexShrink:0,display:(selected||showAddendum||showCreate)?'none':'flex',flexDirection:'column',overflow:'hidden'}}>
        <div style={{padding:'12px 14px',borderBottom:'1px solid var(--fog)',display:'flex',gap:8,background:'var(--white)',alignItems:'center',flexWrap:'wrap'}}>
          <button onClick={()=>{
            setSelected(null)
            setShowCreate(true)
            if (searchParams.get('req')) {
              const p = new URLSearchParams(searchParams.toString())
              p.delete('req')
              router.replace(pathname + '?' + p.toString(), { scroll: false })
            }
          }} style={pBTN}>+ New Request</button>
          <select value={filterStatus} onChange={e=>setFS(e.target.value)} style={selSt}>
            <option value="all">All statuses</option>
            {STATUS_PIPELINE.map(s=><option key={s.key} value={s.key}>{s.label}</option>)}
            <option value="needs_clarification">Needs Clarification</option>
            <option value="quote_rejected">Quote Rejected</option>
            <option value="deposit_required">Deposit Required</option>
            <option value="deposit_paid">Deposit Paid</option>
            <option value="complete_pending_payment">Balance Due</option>
            <option value="fully_paid">Complete</option>
            <option value="rejected">Rejected</option>
          </select>
          <select value={filterArea} onChange={e=>setFA(e.target.value)} style={selSt}>
            <option value="all">All areas</option>
            {BC_AREAS.map(a=><option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div style={{padding:'7px 14px',borderBottom:'1px solid var(--fog)',display:'flex',gap:12,background:'var(--cream)',alignItems:'center',flexWrap:'wrap'}}>
          {[['Total',reqs.length],['Active',reqs.filter(r=>['submitted','needs_clarification','in_review','quoted','quote_rejected','deposit_required','deposit_paid','in_development','complete_pending_payment'].includes(r.status)).length],['Done',reqs.filter(r=>r.status==='fully_paid').length]].map(([l,c])=>(
            <div key={String(l)} style={{display:'flex',alignItems:'baseline',gap:4}}>
              <span style={{fontFamily:'var(--font-mono)',fontSize:14,fontWeight:500,color:'var(--ink)'}}>{c}</span>
              <span style={{fontFamily:'var(--font-mono)',fontSize:8,letterSpacing:'0.12em',textTransform:'uppercase',color:'var(--slate)'}}>{l}</span>
            </div>
          ))}
          {!bcConnected&&!isSuperadmin&&(
            <span style={{marginLeft:'auto',fontFamily:'var(--font-mono)',fontSize:7,letterSpacing:'0.08em',textTransform:'uppercase',color:'var(--slate)',background:'rgba(59,82,73,0.05)',border:'1px solid var(--fog)',padding:'2px 8px',borderRadius:20,cursor:'default'}} title={'Connect your ' + erpLabel + ' instance in Settings for AI-assisted planning'}>
              {'🔌 ' + erpLabel + ' not connected'}
            </span>
          )}
          {(needsClarifCount>0||quoteRejCount>0)&&!isSuperadmin&&(
            <span style={{marginLeft:'auto',fontFamily:'var(--font-mono)',fontSize:8,letterSpacing:'0.1em',textTransform:'uppercase',color:'#A32D2D',background:'rgba(163,45,45,0.07)',border:'1px solid rgba(163,45,45,0.2)',padding:'2px 8px',borderRadius:20}}>
              ⚠ {needsClarifCount+quoteRejCount} need your response
            </span>
          )}
        </div>
        <div style={{flex:1,overflowY:'auto',padding:'10px'}}>
          {filtered.length===0&&(
            <div style={{padding:'40px 20px',textAlign:'center'}}>
              {loading ? (
                <>
                  <div style={{fontSize:32,marginBottom:12}}>⏳</div>
                  <p style={{fontFamily:'var(--font-mono)',fontSize:11,color:'var(--slate)',letterSpacing:'0.05em'}}>Loading customisations…</p>
                </>
              ) : reqs.length===0 ? (
                <>
                  <div style={{fontSize:32,marginBottom:12}}>📋</div>
                  <p style={{fontFamily:'var(--font-body)',fontSize:13,color:'var(--slate)',lineHeight:1.6}}>No customisation requests yet. Click &quot;+ New Request&quot; to get started.</p>
                </>
              ) : (
                <>
                  <div style={{fontSize:32,marginBottom:12}}>🔍</div>
                  <p style={{fontFamily:'var(--font-body)',fontSize:13,color:'var(--slate)',lineHeight:1.6}}>No requests match your filters.</p>
                </>
              )}
            </div>
          )}
          {filtered.map(req=>{
            const prio=priorityMeta(req.priority)
            const sc=STATUS_COLOR[req.status]??STATUS_COLOR.draft
            const spec=parseSpec(req)
            const needsAction=['needs_clarification','quote_rejected','deposit_required','complete_pending_payment'].includes(req.status)&&!isSuperadmin
            const isAct=selected?.id===req.id
            return (
              <div key={req.id} onClick={()=>selectReq(req)} style={{background:needsAction?'rgba(163,45,45,0.03)':isAct?'rgba(10,92,70,0.05)':'var(--white)',border:`1px solid ${needsAction?'rgba(163,45,45,0.2)':isAct?'rgba(10,92,70,0.22)':'var(--fog)'}`,borderRadius:9,padding:'11px 13px',marginBottom:7,cursor:'pointer',transition:'border-color 0.15s'}}>
                <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:8,marginBottom:6}}>
                  <p style={{fontFamily:'var(--font-body)',fontSize:13,fontWeight:600,color:'var(--ink)',lineHeight:1.3,flex:1,margin:0}}>
                    {needsAction&&'⚠️ '}{req.title}
                  </p>
                  <span style={{fontFamily:'var(--font-mono)',fontSize:8,letterSpacing:'0.08em',textTransform:'uppercase',color:prio.color,background:prio.bg,border:`1px solid ${prio.border}`,padding:'2px 7px',borderRadius:6,flexShrink:0}}>{prio.label}</span>
                </div>
                <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
                  <span style={{fontFamily:'var(--font-mono)',fontSize:8,letterSpacing:'0.07em',textTransform:'uppercase',color:sc.text,background:sc.bg,border:`1px solid ${sc.border}`,padding:'2px 7px',borderRadius:6}}>{statusLabel(req.status)}</span>
                  <span style={{fontFamily:'var(--font-mono)',fontSize:9,color:'var(--slate)'}}>{req.bcArea}</span>
                  {isSuperadmin&&<span style={{fontFamily:'var(--font-mono)',fontSize:9,color:'var(--jade)',marginLeft:'auto'}}>{req.tenant.name}</span>}
                  {req.feasibility==='cfo_assistant'&&!req.aiSpec&&<span style={{fontFamily:'var(--font-mono)',fontSize:8,color:'#C8952A',background:'rgba(200,149,42,0.08)',padding:'1px 5px',borderRadius:4}}>💡 no dev needed</span>}
                  {req.feasibility==='infeasible'&&<span style={{fontFamily:'var(--font-mono)',fontSize:8,color:'#A32D2D',background:'rgba(163,45,45,0.07)',padding:'1px 5px',borderRadius:4}}>⚠ constrained</span>}
                  {isSuperadmin&&spec&&<span style={{fontFamily:'var(--font-mono)',fontSize:8,color:'var(--jade)'}}>✦ spec</span>}
                  {isSuperadmin&&(spec?.questions?.length??0)>0&&<span style={{fontFamily:'var(--font-mono)',fontSize:8,color:'#C8952A'}}>? {spec!.questions.length}q</span>}
                  {isSuperadmin&&req.quote&&<span style={{fontFamily:'var(--font-mono)',fontSize:9,color:'var(--forest)',fontWeight:600}}>${parseFloat(req.quote).toLocaleString()}</span>}
                  {/* Review payment / action-step indicators */}
                  {req.status==='draft'&&!spec&&(
                    <span style={{fontFamily:'var(--font-mono)',fontSize:8,color:'var(--slate)',background:'rgba(59,82,73,0.07)',border:'1px solid rgba(59,82,73,0.14)',padding:'1px 6px',borderRadius:4}}>step 1: generate spec</span>
                  )}
                  {req.status==='draft'&&spec&&!req.reviewPaidAt&&!req.reviewIncluded&&!req.reviewBypassed&&(
                    <span style={{fontFamily:'var(--font-mono)',fontSize:8,color:'#9A6A00',background:'rgba(200,149,42,0.1)',border:'1px solid rgba(200,149,42,0.28)',padding:'1px 6px',borderRadius:4}}>↑ review fee required</span>
                  )}
                  {req.status==='draft'&&spec&&(req.reviewPaidAt||req.reviewIncluded||req.reviewBypassed)&&(
                    <span style={{fontFamily:'var(--font-mono)',fontSize:8,color:'var(--forest)',background:'rgba(10,92,70,0.09)',border:'1px solid rgba(10,92,70,0.22)',padding:'1px 6px',borderRadius:4}}>✓ paid · submit to proceed</span>
                  )}
                  {req.status!=='draft'&&req.reviewPaidAt&&['draft','submitted','needs_clarification','in_review','quoted','quote_rejected','deposit_required'].includes(req.status)&&(
                    <span style={{fontFamily:'var(--font-mono)',fontSize:8,color:'var(--forest)',background:'rgba(10,92,70,0.08)',border:'1px solid rgba(10,92,70,0.18)',padding:'1px 6px',borderRadius:4}}>✓ review paid</span>
                  )}
                  {req.status!=='draft'&&req.reviewIncluded&&!req.reviewPaidAt&&['draft','submitted','needs_clarification','in_review','quoted','quote_rejected','deposit_required'].includes(req.status)&&(
                    <span style={{fontFamily:'var(--font-mono)',fontSize:8,color:'var(--jade)',background:'rgba(26,146,114,0.08)',border:'1px solid rgba(26,146,114,0.2)',padding:'1px 6px',borderRadius:4}}>✓ included in plan</span>
                  )}
                  {req.status!=='draft'&&req.reviewBypassed&&!req.reviewPaidAt&&!req.reviewIncluded&&['draft','submitted','needs_clarification','in_review','quoted','quote_rejected','deposit_required'].includes(req.status)&&(
                    <span style={{fontFamily:'var(--font-mono)',fontSize:8,color:'var(--slate)',background:'rgba(59,82,73,0.07)',border:'1px solid rgba(59,82,73,0.16)',padding:'1px 6px',borderRadius:4}}>✓ fee waived</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Right panel ───────────────────────────────────────────────────── */}
      {panelOpen&&(
        <div style={{flex:1,overflowY:'auto',background:'var(--cream)',padding:'22px 26px',display:'flex',flexDirection:'column',gap:18}}>

          {/* ADDENDUM — full create flow linked to parent */}
          {showAddendum&&<>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div>
                <h2 style={{fontFamily:'var(--font-display)',fontSize:22,fontWeight:500,color:'var(--ink)',lineHeight:1,margin:0}}>Add Addendum</h2>
                <p style={{fontFamily:'var(--font-mono)',fontSize:9,color:'var(--slate)',margin:'6px 0 0',letterSpacing:'0.08em'}}>
                  {'Linked to: '}{addendumParentTitle}
                </p>
              </div>
              <button onClick={()=>{setShowAddendum(false);setAddendumParentId(null);setAddendumParentTitle('');setAddendumErr('')}} style={xBTN}>✕</button>
            </div>
            <div style={crd}>
              <label style={lbl}>Title <span style={{color:'#A32D2D'}}>*</span></label>
              <input placeholder="e.g. Also add approval for purchase credit memos" value={addendumForm.title} onChange={e=>setAddendumForm(f=>({...f,title:e.target.value}))} style={iSt} onFocus={fo} onBlur={bl}/>
            </div>
            <div style={crd}>
              <label style={lbl}>Describe what you need <span style={{color:'#A32D2D'}}>*</span></label>
              <p style={{fontFamily:'var(--font-body)',fontSize:11,color:'var(--slate)',marginBottom:10,lineHeight:1.55}}>
                Describe the additional work clearly — what is missing from the original scope, why it is needed, and what success looks like. BespoxAI will scope it and it will be quoted separately.
              </p>
              <textarea placeholder="e.g. We realised we also need the same approval logic applied to purchase credit memos, not just purchase orders. The approvers and thresholds should be the same…" value={addendumForm.description} onChange={e=>setAddendumForm(f=>({...f,description:e.target.value}))} rows={7} style={{...iSt,resize:'vertical',lineHeight:1.65}} onFocus={fo} onBlur={bl}/>
            </div>
            <div style={{display:'flex',gap:12}}>
              <div style={{...crd,flex:1}}>
                <label style={lbl}>{erpLabel} Area</label>
                <select value={addendumForm.bcArea} onChange={e=>setAddendumForm(f=>({...f,bcArea:e.target.value}))} style={{...iSt,cursor:'pointer'}}>{BC_AREAS.map(a=><option key={a} value={a}>{a}</option>)}</select>
              </div>
              <div style={{...crd,flex:1}}>
                <label style={lbl}>Priority</label>
                <select value={addendumForm.priority} onChange={e=>setAddendumForm(f=>({...f,priority:e.target.value}))} style={{...iSt,cursor:'pointer'}}>{PRIORITIES.map(p=><option key={p.value} value={p.value}>{p.label}</option>)}</select>
              </div>
            </div>
            {addendumErr&&<p style={{fontFamily:'var(--font-body)',fontSize:12,color:'#A32D2D'}}>{addendumErr}</p>}
            <div style={{display:'flex',gap:10}}>
              <button onClick={submitAddendum} disabled={addendumSaving} style={{...pBTN,opacity:addendumSaving?0.7:1}}>{addendumSaving?'Saving…':'Save & Scope →'}</button>
              <button onClick={()=>{setShowAddendum(false);setAddendumParentId(null);setAddendumParentTitle('');setAddendumErr('')}} style={sBTN}>Cancel</button>
            </div>
          </>}

          {/* CREATE */}
          {showCreate&&<>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <h2 style={{fontFamily:'var(--font-display)',fontSize:22,fontWeight:500,color:'var(--ink)',lineHeight:1,margin:0}}>New Customisation Request</h2>
              <button onClick={()=>setShowCreate(false)} style={xBTN}>✕</button>
            </div>
            <div style={crd}>
              <label style={lbl}>Title <span style={{color:'#A32D2D'}}>*</span></label>
              <input placeholder="e.g. Add two-level approval to purchase orders" value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} style={iSt} onFocus={fo} onBlur={bl}/>
            </div>
            <div style={crd}>
              <label style={lbl}>Describe what you need <span style={{color:'#A32D2D'}}>*</span></label>
              <p style={{fontFamily:'var(--font-body)',fontSize:11,color:'var(--slate)',marginBottom:10,lineHeight:1.55}}>
                Write in plain English — the business problem, who is involved, current workarounds, and what success looks like. BespoxAI will first check feasibility and whether development is actually needed, then generate a full specification if required.
              </p>
              <textarea placeholder="e.g. Right now purchase orders go straight to the vendor with no approval. We need two levels: line manager for orders under $5k, CFO for anything above. Approvers need an email with a link to approve or reject directly in BC..." value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} rows={7} style={{...iSt,resize:'vertical',lineHeight:1.65}} onFocus={fo} onBlur={bl}/>
            </div>
            <div style={{display:'flex',gap:12}}>
              <div style={{...crd,flex:1}}>
                <label style={lbl}>{erpLabel} Area</label>
                <select value={form.bcArea} onChange={e=>setForm(f=>({...f,bcArea:e.target.value}))} style={{...iSt,cursor:'pointer'}}>{BC_AREAS.map(a=><option key={a} value={a}>{a}</option>)}</select>
              </div>
              <div style={{...crd,flex:1}}>
                <label style={lbl}>Priority</label>
                <select value={form.priority} onChange={e=>setForm(f=>({...f,priority:e.target.value}))} style={{...iSt,cursor:'pointer'}}>{PRIORITIES.map(p=><option key={p.value} value={p.value}>{p.label}</option>)}</select>
              </div>
            </div>
            {formErr&&<p style={{fontFamily:'var(--font-body)',fontSize:12,color:'#A32D2D'}}>{formErr}</p>}
            <div style={{display:'flex',gap:10}}>
              <button onClick={createReq} disabled={saving} style={{...pBTN,opacity:saving?0.7:1}}>{saving?'Saving…':'Save & Check Feasibility →'}</button>
              <button onClick={()=>setShowCreate(false)} style={sBTN}>Cancel</button>
            </div>
          </>}

          {/* DETAIL */}
          {selected&&!showCreate&&(()=>{
            const req   = selected
            const prio  = priorityMeta(req.priority)
            const sc    = STATUS_COLOR[req.status]??STATUS_COLOR.draft
            const spec  = parseSpec(req)
            const si    = STATUS_PIPELINE.findIndex(s=>s.key===req.status)
            const pipelineDateMap: Record<string,string|null|undefined> = {
              draft:                    req.createdAt,
              submitted:                req.submittedAt,
              in_review:                req.inReviewAt,
              quoted:                   req.quotedAt,
              deposit_required:         req.depositRequiredAt,
              deposit_paid:             req.depositPaidAt,
              in_development:           req.inDevelopmentAt,
              in_uat:                   req.testDeployedAt,
              uat_confirmed:            req.uatApprovedAt,
              complete_pending_payment: req.completePendingPaymentAt,
              fully_paid:               req.balancePaidAt,
            }
            const needsClarif = req.status==='needs_clarification'
            const quoteRej    = req.status==='quote_rejected'

            // Parse saved customer answers
            const savedAnswers = parseAnswers(req.customerAnswers)
            const savedQA: QAPair[] = Array.isArray(savedAnswers) ? savedAnswers : []
            const savedText: string = typeof savedAnswers==='string' ? savedAnswers : ''

            return <>
              {/* Header */}
              <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:12}}>
                <div style={{flex:1}}>
                  {req.parentId ? (
                    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                      <span style={{fontFamily:'var(--font-mono)',fontSize:8,letterSpacing:'0.1em',textTransform:'uppercase',background:'rgba(200,149,42,0.1)',color:'#9A6A00',border:'1px solid rgba(200,149,42,0.25)',borderRadius:5,padding:'2px 8px'}}>Addendum</span>
                      <button
                        onClick={()=>{ const parent=reqs.find(r=>r.id===req.parentId); if(parent) selectReq(parent) }}
                        style={{fontFamily:'var(--font-mono)',fontSize:9,color:'var(--slate)',background:'none',border:'none',cursor:'pointer',padding:0,textDecoration:'underline'}}
                      >{'← Back to original requirement'}</button>
                    </div>
                  ) : null}
                  <h2 style={{fontFamily:'var(--font-display)',fontSize:21,fontWeight:500,color:'var(--ink)',lineHeight:1.3,marginBottom:10}}>{req.title}</h2>
                  <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                    <span style={{fontFamily:'var(--font-mono)',fontSize:9,letterSpacing:'0.1em',textTransform:'uppercase',color:sc.text,background:sc.bg,border:`1px solid ${sc.border}`,padding:'3px 10px',borderRadius:20}}>{statusLabel(req.status)}</span>
                    <span style={{fontFamily:'var(--font-mono)',fontSize:9,letterSpacing:'0.1em',textTransform:'uppercase',color:prio.color,background:prio.bg,border:`1px solid ${prio.border}`,padding:'3px 10px',borderRadius:20}}>{prio.label}</span>
                    <span style={{fontFamily:'var(--font-mono)',fontSize:10,color:'var(--slate)'}}>{req.bcArea}</span>
                    {isSuperadmin&&<span style={{fontFamily:'var(--font-mono)',fontSize:10,color:'var(--jade)'}}>{req.tenant.name} · {req.user.name??req.user.email}</span>}
                  </div>
                </div>
                <button onClick={()=>clearReq()} style={xBTN}>✕</button>
              </div>

              {/* Needs clarification banner */}
              {needsClarif&&!isSuperadmin&&req.adminQuestions&&(
                <div style={{background:'rgba(163,45,45,0.05)',border:'1px solid rgba(163,45,45,0.25)',borderRadius:10,padding:'16px 18px'}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
                    <span style={{fontSize:16}}>⚠️</span>
                    <span style={{fontFamily:'var(--font-mono)',fontSize:9,letterSpacing:'0.12em',textTransform:'uppercase',color:'#A32D2D',fontWeight:600}}>BespoxAI has questions before proceeding</span>
                  </div>
                  <p style={{fontFamily:'var(--font-body)',fontSize:13,color:'var(--ink)',lineHeight:1.7,whiteSpace:'pre-wrap',marginBottom:14}}>{req.adminQuestions}</p>
                  <label style={lbl}>Your answers</label>
                  <textarea placeholder="Please answer each question as fully as possible. You can also update the description below before resubmitting." value={adminAnswerDraft} onChange={e=>setAAD(e.target.value)} rows={5} style={{...iSt,resize:'vertical',lineHeight:1.65,marginBottom:10}} onFocus={fo} onBlur={bl}/>

                  {/* Previous Q&A rounds */}
                  {(()=>{
                    let log:any[]=[]
                    try{log=req.adminQALog?JSON.parse(req.adminQALog):[]}catch{}
                    const prev=log.filter((r:any)=>r.answers!==null)
                    return prev.length>0?(
                      <div style={{marginBottom:10,padding:'10px 12px',background:'rgba(163,45,45,0.04)',borderRadius:6,border:'1px solid rgba(163,45,45,0.12)'}}>
                        <p style={{fontFamily:'var(--font-mono)',fontSize:8,letterSpacing:'0.1em',textTransform:'uppercase',color:'rgba(163,45,45,0.5)',marginBottom:8}}>Previous consultation rounds on record</p>
                        {prev.map((r:any,i:number)=>(
                          <div key={i} style={{marginBottom:8,paddingLeft:8,borderLeft:'2px solid rgba(163,45,45,0.2)'}}>
                            <p style={{fontFamily:'var(--font-mono)',fontSize:8,color:'rgba(163,45,45,0.5)',marginBottom:3}}>Round {r.round} · {new Date(r.askedAt).toLocaleDateString('en-NZ')}</p>
                            <p style={{fontFamily:'var(--font-body)',fontSize:11,color:'var(--ink)',lineHeight:1.55,whiteSpace:'pre-wrap',marginBottom:4}}>{r.questions}</p>
                            <p style={{fontFamily:'var(--font-body)',fontSize:11,color:'var(--slate)',lineHeight:1.55,fontStyle:'italic'}}>{r.answers}</p>
                          </div>
                        ))}
                      </div>
                    ):null
                  })()}

                  <button onClick={async()=>{await patch(req.id,{customerAnswers:adminAnswerDraft,status:'submitted'});setAAD('')}} disabled={!adminAnswerDraft.trim()||actLoading} style={{...pBTN,opacity:!adminAnswerDraft.trim()?0.6:1}}>
                    Resubmit with Answers →
                  </button>
                </div>
              )}

              {/* Quote rejected banner — customer view with edit form */}
              {quoteRej&&!isSuperadmin&&(
                <div style={{background:'rgba(163,45,45,0.05)',border:'1px solid rgba(163,45,45,0.25)',borderRadius:10,padding:'16px 18px'}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                    <span style={{fontSize:16}}>❌</span>
                    <span style={{fontFamily:'var(--font-mono)',fontSize:9,letterSpacing:'0.12em',textTransform:'uppercase',color:'#A32D2D',fontWeight:600}}>Quote rejected</span>
                  </div>
                  {req.quoteRejectionReason&&<p style={{fontFamily:'var(--font-body)',fontSize:13,color:'var(--ink)',lineHeight:1.7,marginBottom:14,fontStyle:'italic'}}>"{req.quoteRejectionReason}"</p>}
                  <p style={{fontFamily:'var(--font-body)',fontSize:12,color:'var(--slate)',marginBottom:16,lineHeight:1.55}}>
                    Update your requirements below before resubmitting — you can revise scope, add context from the quote discussion, or adjust priority to help us provide a revised quote.
                  </p>

                  {/* Inline edit fields */}
                  <div style={{display:'flex',flexDirection:'column',gap:12}}>
                    <div>
                      <label style={lbl}>Title</label>
                      <input value={resubmitForm.title} onChange={e=>setRF(f=>({...f,title:e.target.value}))} style={iSt} onFocus={fo} onBlur={bl}/>
                    </div>
                    <div>
                      <label style={lbl}>Updated description / revised scope</label>
                      <textarea value={resubmitForm.description} onChange={e=>setRF(f=>({...f,description:e.target.value}))} rows={5} style={{...iSt,resize:'vertical',lineHeight:1.65}} onFocus={fo} onBlur={bl}/>
                    </div>
                    <div style={{display:'flex',gap:12}}>
                      <div style={{flex:1}}>
                        <label style={lbl}>{erpLabel} Area</label>
                        <select value={resubmitForm.bcArea} onChange={e=>setRF(f=>({...f,bcArea:e.target.value}))} style={{...iSt,cursor:'pointer'}}>{BC_AREAS.map(a=><option key={a} value={a}>{a}</option>)}</select>
                      </div>
                      <div style={{flex:1}}>
                        <label style={lbl}>Priority</label>
                        <select value={resubmitForm.priority} onChange={e=>setRF(f=>({...f,priority:e.target.value}))} style={{...iSt,cursor:'pointer'}}>{PRIORITIES.map(p=><option key={p.value} value={p.value}>{p.label}</option>)}</select>
                      </div>
                    </div>
                    <div>
                      <label style={lbl}>Additional context for revised quote (optional)</label>
                      <textarea placeholder="e.g. We'd like to reduce scope to just the basic approval flow without email notifications to bring costs down." value={resubmitForm.extraContext} onChange={e=>setRF(f=>({...f,extraContext:e.target.value}))} rows={3} style={{...iSt,resize:'vertical',lineHeight:1.65}} onFocus={fo} onBlur={bl}/>
                    </div>
                    <button
                      onClick={async()=>{
                        const updates:any = { status:'submitted', title:resubmitForm.title, description:resubmitForm.description, bcArea:resubmitForm.bcArea, priority:resubmitForm.priority }
                        if (resubmitForm.extraContext.trim()) updates.customerAnswers = resubmitForm.extraContext.trim()
                        await patch(req.id, updates)
                      }}
                      disabled={actLoading||!resubmitForm.title.trim()||!resubmitForm.description.trim()}
                      style={{...pBTN,opacity:(!resubmitForm.title.trim()||!resubmitForm.description.trim())?0.6:1}}
                    >
                      Resubmit for Revised Quote →
                    </button>
                  </div>
                </div>
              )}

              {/* Quote rejected — admin view */}
              {quoteRej&&isSuperadmin&&req.quoteRejectionReason&&(
                <div style={{background:'rgba(163,45,45,0.05)',border:'1px solid rgba(163,45,45,0.25)',borderRadius:10,padding:'16px 18px'}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                    <span style={{fontSize:16}}>❌</span>
                    <span style={{fontFamily:'var(--font-mono)',fontSize:9,letterSpacing:'0.12em',textTransform:'uppercase',color:'#A32D2D',fontWeight:600}}>Customer rejected quote</span>
                  </div>
                  <p style={{fontFamily:'var(--font-body)',fontSize:13,color:'var(--ink)',lineHeight:1.7,fontStyle:'italic'}}>"{req.quoteRejectionReason}"</p>
                  {req.quoteRejectedAt&&<p style={{fontFamily:'var(--font-mono)',fontSize:9,color:'var(--slate)',marginTop:6}}>Rejected {new Date(req.quoteRejectedAt).toLocaleDateString('en-NZ',{dateStyle:'medium'})}</p>}
                </div>
              )}


              {/* Feasibility check result */}
              {(feasLoadingId===req.id||req.feasibility)&&(
                <div style={{background:'var(--white)',border:'1px solid var(--fog)',borderRadius:10,padding:'18px 20px'}}>
                  <div style={{fontFamily:'var(--font-mono)',fontSize:9,letterSpacing:'0.14em',textTransform:'uppercase',color:'var(--slate)',marginBottom:isCardCollapsed('feasib-'+req.id) ? 0 : 12,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <div style={{display:'flex',gap:12,alignItems:'center'}}>
                      <span>BespoxAI Feasibility Check</span>
                      {req.feasibilityCheckedAt&&<span style={{color:'rgba(59,82,73,0.5)',fontSize:8}}>{new Date(req.feasibilityCheckedAt).toLocaleDateString('en-NZ',{dateStyle:'medium'})}</span>}
                    </div>
                    <CardToggleBtn collapsed={!!isCardCollapsed('feasib-'+req.id)} onToggle={()=>toggleCard('feasib-'+req.id)} />
                  </div>
                  <div style={{overflow:'hidden',maxHeight:isCardCollapsed('feasib-'+req.id) ? 0 : '9999px',transition:'max-height 0.25s ease'}}>

                  {feasLoadingId===req.id&&(
                    <div style={{display:'flex',alignItems:'center',gap:10}}>
                      <div style={{width:14,height:14,borderRadius:'50%',border:'2px solid var(--forest)',borderTopColor:'transparent',animation:'spin 0.8s linear infinite',flexShrink:0}}/>
                      <span style={{fontFamily:'var(--font-body)',fontSize:13,color:'var(--slate)'}}>BespoxAI is checking feasibility…</span>
                    </div>
                  )}

                  {feasLoadingId!==req.id&&req.feasibility==='cfo_assistant'&&(
                    <div>
                      <div style={{display:'flex',gap:10,alignItems:'flex-start',marginBottom:14}}>
                        <span style={{fontSize:20,flexShrink:0}}>💡</span>
                        <div>
                          <div style={{fontFamily:'var(--font-mono)',fontSize:9,letterSpacing:'0.12em',textTransform:'uppercase',color:'#C8952A',marginBottom:6}}>This may not need development</div>
                          <p style={{fontFamily:'var(--font-body)',fontSize:13,color:'var(--ink)',lineHeight:1.7,margin:0}}>{req.feasibilityNotes}</p>
                        </div>
                      </div>
                      <div style={{paddingTop:12,borderTop:'1px solid var(--fog)',display:'flex',gap:8,flexWrap:'wrap'}}>
                        <button onClick={()=>window.location.href='/dashboard?view=chat'} style={pBTN}>Try CFO Assistant →</button>
                        <button onClick={()=>generateSpec(req)} disabled={genSpec} style={{...sBTN,opacity:genSpec?0.7:1}}>{genSpec?'Generating…':'Scope as development anyway'}</button>
                      </div>
                    </div>
                  )}

                  {feasLoadingId!==req.id&&req.feasibility==='development'&&(
                    <div>
                      <div style={{display:'flex',gap:10,alignItems:'flex-start',marginBottom:spec?0:14}}>
                        <span style={{fontSize:20,flexShrink:0}}>✅</span>
                        <div style={{flex:1}}>
                          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6,flexWrap:'wrap',gap:6}}>
                            <div style={{fontFamily:'var(--font-mono)',fontSize:9,letterSpacing:'0.12em',textTransform:'uppercase',color:'var(--forest)'}}>Development required — feasible</div>
                            {req.feasibilityCostRange&&<span style={{fontFamily:'var(--font-mono)',fontSize:9,color:'var(--forest)',background:'rgba(10,92,70,0.08)',border:'1px solid rgba(10,92,70,0.2)',borderRadius:20,padding:'2px 10px'}}>{formatCostRange(req.feasibilityCostRange)}</span>}
                          </div>
                          <p style={{fontFamily:'var(--font-body)',fontSize:13,color:'var(--ink)',lineHeight:1.7,margin:0}}>{req.feasibilityNotes}</p>
                        </div>
                      </div>
                      {!spec&&(
                        <div style={{paddingTop:12,borderTop:'1px solid var(--fog)'}}>
                          <button onClick={()=>generateSpec(req)} disabled={genSpec} style={{...pBTN,opacity:genSpec?0.7:1}}>{genSpec?'Generating spec…':'Generate Full Specification →'}</button>
                          {specErr&&<p style={{fontFamily:'var(--font-body)',fontSize:12,color:'#A32D2D',marginTop:8}}>{specErr}</p>}
                        </div>
                      )}
                    </div>
                  )}

                  {feasLoadingId!==req.id&&req.feasibility==='infeasible'&&(
                    <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
                      <span style={{fontSize:20,flexShrink:0}}>⚠️</span>
                      <div>
                        <div style={{fontFamily:'var(--font-mono)',fontSize:9,letterSpacing:'0.12em',textTransform:'uppercase',color:'#A32D2D',marginBottom:6}}>Technical constraints identified</div>
                        <p style={{fontFamily:'var(--font-body)',fontSize:13,color:'var(--ink)',lineHeight:1.7,marginBottom:12}}>{req.feasibilityNotes}</p>
                        <a href="mailto:hello@bespoxai.com" style={{...sBTN,textDecoration:'none',display:'inline-block'}}>Contact us to discuss →</a>
                      </div>
                    </div>
                  )}

                  {feasErr&&<p style={{fontFamily:'var(--font-body)',fontSize:12,color:'#A32D2D',marginTop:8}}>{feasErr}</p>}
                  </div>
                </div>
              )}

              {/* Pipeline */}
              {!['needs_clarification','rejected','quote_rejected'].includes(req.status)&&req.status!=='fully_paid'&&(
                <div style={crd}>
                  <label style={lbl}>Progress</label>
                  <div style={{display:'flex',alignItems:'center',marginTop:6}}>
                    {STATUS_PIPELINE.map((s,i)=>{
                      const done=i<si,cur=i===si
                      const pds = pipelineDateMap[s.key]
                      const pdfmt = pds ? new Date(pds).toLocaleDateString('en-NZ',{day:'2-digit',month:'short'}) : null
                      return (
                        <div key={s.key} style={{display:'flex',alignItems:'center',flex:i<STATUS_PIPELINE.length-1?1:'none'}}>
                          <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:3}}>
                            <div style={{width:18,height:18,borderRadius:'50%',background:done?'var(--jade)':cur?'var(--forest)':'var(--fog)',boxShadow:cur?'0 0 0 3px rgba(10,92,70,0.15)':'none',display:'flex',alignItems:'center',justifyContent:'center'}}>
                              {done&&<span style={{color:'white',fontSize:9}}>✓</span>}
                            </div>
                            <span style={{fontFamily:'var(--font-mono)',fontSize:7,letterSpacing:'0.07em',textTransform:'uppercase',color:cur?'var(--forest)':done?'var(--jade)':'var(--slate)',textAlign:'center',whiteSpace:'nowrap'}}>{s.label}</span>
                            {pdfmt&&<span style={{fontFamily:'var(--font-mono)',fontSize:6,color:done?'var(--jade)':cur?'var(--forest)':'var(--slate)',textAlign:'center',whiteSpace:'nowrap',letterSpacing:'0.04em'}}>{pdfmt}</span>}
                          </div>
                          {i<STATUS_PIPELINE.length-1&&<div style={{flex:1,height:2,background:done?'var(--jade)':'var(--fog)',margin:'0 2px',marginBottom:pdfmt?26:18}}/>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Description */}
              <div style={crd}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:isCardCollapsed('desc-'+req.id) ? 0 : 8}}>
                  <label style={{...lbl,marginBottom:0}}>Description</label>
                  <CardToggleBtn collapsed={!!isCardCollapsed('desc-'+req.id)} onToggle={()=>toggleCard('desc-'+req.id)} />
                </div>
                <div style={{overflow:'hidden',maxHeight:isCardCollapsed('desc-'+req.id) ? 0 : '9999px',transition:'max-height 0.25s ease'}}>
                  <p style={{fontFamily:'var(--font-body)',fontSize:13,color:'var(--ink)',lineHeight:1.75,whiteSpace:'pre-wrap'}}>{req.description}</p>
                  {(savedQA.length>0||savedText)&&(
                    <div style={{marginTop:14,paddingTop:14,borderTop:'1px solid var(--fog)'}}>
                      <label style={{...lbl,color:'var(--jade)'}}>Clarification provided</label>
                      {savedQA.length>0 ? (
                        <div style={{display:'flex',flexDirection:'column',gap:12}}>
                          {savedQA.map((pair,i)=>(
                            <div key={i}>
                              <p style={{fontFamily:'var(--font-body)',fontSize:11,color:'var(--slate)',marginBottom:3,fontStyle:'italic'}}>Q{i+1}: {pair.q}</p>
                              <p style={{fontFamily:'var(--font-body)',fontSize:13,color:'var(--ink)',lineHeight:1.6,paddingLeft:12,borderLeft:'2px solid var(--jade)'}}>{pair.a}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p style={{fontFamily:'var(--font-body)',fontSize:12,color:'var(--slate)',lineHeight:1.7,whiteSpace:'pre-wrap'}}>{savedText}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* AI Spec */}
              {spec?(
                <div style={{...crd,padding:'18px 20px'}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
                    <div>
                      <label style={lbl}>AI-Generated Functional Spec</label>
                      <div style={{display:'flex',gap:8,marginTop:4,alignItems:'center'}}>
                        <span style={{fontFamily:'var(--font-mono)',fontSize:9,letterSpacing:'0.1em',textTransform:'uppercase',padding:'2px 8px',borderRadius:6,background:cxBg(spec.complexity),color:cxCol(spec.complexity),border:`1px solid ${cxBdr(spec.complexity)}`}}>{spec.complexity}</span>
                        <span style={{fontFamily:'var(--font-mono)',fontSize:9,color:'var(--slate)'}}>Est. {spec.estimatedDays} day{spec.estimatedDays!==1?'s':''}</span>
                        {!isSuperadmin&&(()=>{
                          const gc=getGenCount(req)
                          const rem=MAX_GENS-gc
                          return (
                            <span style={{fontFamily:'var(--font-mono)',fontSize:8,color:rem===0?'#A32D2D':rem===1?'#C8952A':'var(--slate)',letterSpacing:'0.08em'}}>
                              {rem===0?'✕ no regenerations left':`↺ ${rem} regeneration${rem!==1?'s':''} left`}
                            </span>
                          )
                        })()}
                      </div>
                    </div>
                    {(req.status==='draft'||req.status==='submitted'&&!!req.parentId||req.status==='needs_clarification'||req.status==='quote_rejected'||isSuperadmin)&&(()=>{
                      const gc=getGenCount(req)
                      const atLimit=!isSuperadmin&&gc>=MAX_GENS
                      return atLimit ? (
                        <span style={{fontFamily:'var(--font-mono)',fontSize:8,color:'#A32D2D',letterSpacing:'0.08em'}}>✕ limit reached — submit or contact BespoxAI</span>
                      ) : (
                        <button
                          onClick={()=>{
                            setShowRefine(true)
                            setEditedUS(spec.userStory ?? '')
                            setEditedCrit([...(spec.acceptanceCriteria ?? [])])
                          }}
                          disabled={genSpec}
                          style={{...sBTN,fontSize:11}}
                        >
                          ✏ Refine &amp; Regenerate
                        </button>
                      )
                    })()}
                  </div>

                  <CardToggleBtn collapsed={!!isCardCollapsed('spec-'+req.id)} onToggle={()=>toggleCard('spec-'+req.id)} />
                  </div>
                  <div style={{overflow:'hidden',maxHeight:isCardCollapsed('spec-'+req.id) ? 0 : '9999px',transition:'max-height 0.25s ease'}}>
                  {/* Refinement panel */}
                  {showRefine&&!isSuperadmin&&(()=>{
                    const gc=getGenCount(req)
                    const remsAfter=MAX_GENS-(gc+1)
                    return (
                      <div style={{background:'rgba(10,92,70,0.04)',border:'1px solid rgba(10,92,70,0.2)',borderRadius:8,padding:'16px 18px',marginTop:4}}>
                        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
                          <span style={{fontFamily:'var(--font-mono)',fontSize:9,letterSpacing:'0.12em',textTransform:'uppercase',color:'var(--forest)'}}>✏ Refine this spec</span>
                          <span style={{fontFamily:'var(--font-mono)',fontSize:8,color:'var(--slate)'}}>
                            {remsAfter>=0?`${remsAfter} regeneration${remsAfter!==1?'s':''} remaining after this`:'last regeneration'}
                          </span>
                        </div>
                        <p style={{fontFamily:'var(--font-body)',fontSize:12,color:'var(--slate)',marginBottom:14,lineHeight:1.55}}>
                          Describe what you want changed, edit the user story, or update the acceptance criteria. All context from previous generations is carried forward — only describe what's different.
                        </p>

                        <div style={{display:'flex',flexDirection:'column',gap:12}}>
                          <div>
                            <label style={lbl}>What to change <span style={{color:'var(--slate)',fontWeight:400,textTransform:'none',letterSpacing:0}}>(describe in plain English)</span></label>
                            <textarea
                              placeholder={'e.g. The approval threshold should be $10,000 not $5,000. Also we need the approved orders to automatically email the vendor, not just change status in BC. Remove the CFO approval level — just one approver.'}
                              value={refinementText}
                              onChange={e=>setRefinementText(e.target.value)}
                              rows={4}
                              style={{...iSt,resize:'vertical',lineHeight:1.65}}
                              onFocus={fo} onBlur={bl}
                            />
                          </div>
                          <div>
                            <label style={lbl}>Edit user story</label>
                            <textarea
                              value={editedUserStory}
                              onChange={e=>setEditedUS(e.target.value)}
                              rows={2}
                              style={{...iSt,resize:'vertical',lineHeight:1.55,fontStyle:'italic'}}
                              onFocus={fo} onBlur={bl}
                            />
                          </div>
                          <div>
                            <label style={lbl}>Edit acceptance criteria <span style={{color:'var(--slate)',fontWeight:400,textTransform:'none',letterSpacing:0}}>(one per line)</span></label>
                            <textarea
                              value={editedCriteria.join('\n')}
                              onChange={e=>setEditedCrit(e.target.value.split('\n'))}
                              rows={Math.max(3,editedCriteria.length+1)}
                              style={{...iSt,resize:'vertical',lineHeight:1.65}}
                              onFocus={fo} onBlur={bl}
                            />
                          </div>
                          <div style={{display:'flex',gap:8}}>
                            <button
                              onClick={()=>generateSpec(req,undefined,{text:refinementText,userStory:editedUserStory,criteria:editedCriteria.filter(c=>c.trim())})}
                              disabled={genSpec||(!refinementText.trim()&&!editedUserStory.trim()&&editedCriteria.filter(c=>c.trim()).length===0)}
                              style={{...pBTN,opacity:(!refinementText.trim()&&!editedUserStory.trim())?0.6:1}}
                            >
                              {genSpec?'✦ Regenerating…':'✦ Regenerate from Changes'}
                            </button>
                            <button onClick={()=>{setShowRefine(false);setRefinementText('');setEditedUS(spec.userStory??'');setEditedCrit([...(spec.acceptanceCriteria??[])])}} style={sBTN}>Cancel</button>
                          </div>
                          {specErr&&<p style={{color:'#A32D2D',fontSize:11}}>{specErr}</p>}
                        </div>
                      </div>
                    )
                  })()}

                  <div style={{display:'flex',flexDirection:'column',gap:16}}>
                    <Sect title="User Story">
                      <p style={{fontFamily:'var(--font-body)',fontSize:13,color:'var(--ink)',lineHeight:1.7,fontStyle:'italic'}}>{spec.userStory}</p>
                      {(spec._history?.length ?? 0)>0&&(
                        <div style={{marginTop:8,paddingTop:8,borderTop:'1px solid var(--fog)'}}>
                          <p style={{fontFamily:'var(--font-mono)',fontSize:8,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--slate)',marginBottom:5}}>Version history</p>
                          <div style={{display:'flex',flexDirection:'column',gap:2}}>
                            {(spec._history ?? []).map((h,i)=>(
                              <span key={i} style={{fontFamily:'var(--font-mono)',fontSize:9,color:'rgba(59,82,73,0.5)'}}>v{i+1}: {h.trigger} — {new Date(h.at).toLocaleDateString()}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </Sect>

                    <Sect title="Acceptance Criteria">
                      <ul style={{margin:0,paddingLeft:18,display:'flex',flexDirection:'column',gap:5}}>
                        {spec.acceptanceCriteria.map((c,i)=><li key={i} style={{fontFamily:'var(--font-body)',fontSize:12,color:'var(--ink)',lineHeight:1.65}}>{c}</li>)}
                      </ul>
                    </Sect>

                    {spec.bcObjects?.length>0&&(
                      <Sect title={erpLabel + ' Objects Affected'}>
                        <div style={{display:'flex',flexDirection:'column',gap:4}}>
                          {spec.bcObjects.map((o,i)=><span key={i} style={{fontFamily:'var(--font-mono)',fontSize:10,background:'var(--parchment)',border:'1px solid var(--fog)',borderRadius:6,padding:'4px 10px',color:'var(--slate)',display:'inline-block'}}>{o}</span>)}
                        </div>
                      </Sect>
                    )}

                    {spec.assumptions?.length>0&&(
                      <Sect title="Assumptions Made" titleColor="#C8952A">
                        <ul style={{margin:'0 0 8px',paddingLeft:18,display:'flex',flexDirection:'column',gap:4}}>
                          {spec.assumptions.map((a,i)=><li key={i} style={{fontFamily:'var(--font-body)',fontSize:12,color:'var(--ink)',lineHeight:1.65}}>{a}</li>)}
                        </ul>
                        <p style={{fontFamily:'var(--font-body)',fontSize:11,color:'var(--slate)',fontStyle:'italic'}}>If any assumption is wrong, answer the questions below and regenerate.</p>
                      </Sect>
                    )}

                    {/* Questions — per-question answer fields */}
                    {spec.questions?.length>0&&(
                      <div style={{background:'rgba(200,149,42,0.06)',border:'1px solid rgba(200,149,42,0.25)',borderRadius:8,padding:'14px 16px'}}>
                        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
                          <span style={{fontSize:14}}>💬</span>
                          <span style={{fontFamily:'var(--font-mono)',fontSize:9,letterSpacing:'0.12em',textTransform:'uppercase',color:'#9A6A00',fontWeight:600}}>
                            Clarifying Questions — answer to refine the spec
                          </span>
                        </div>
                        {(req.status==='draft'||req.status==='submitted'&&!!req.parentId||req.status==='needs_clarification'||req.status==='quote_rejected'||isSuperadmin)&&showQAPanel?(
                          <div style={{display:'flex',flexDirection:'column',gap:14}}>
                            {spec.questions.map((q,i)=>(
                              <div key={i}>
                                <p style={{fontFamily:'var(--font-body)',fontSize:13,color:'var(--ink)',lineHeight:1.6,marginBottom:6}}><strong>{i+1}.</strong> {q}</p>
                                <textarea
                                  placeholder="Your answer…"
                                  value={qaAnswers[i]??''}
                                  onChange={e=>setQAAnswers(prev=>({...prev,[i]:e.target.value}))}
                                  rows={2}
                                  style={{...iSt,resize:'vertical',lineHeight:1.55}}
                                  onFocus={fo} onBlur={bl}
                                />
                              </div>
                            ))}
                            <div style={{display:'flex',gap:8,marginTop:4}}>{(()=>{
                              const gc=getGenCount(req)
                              const atLimit=!isSuperadmin&&gc>=MAX_GENS
                              return <>
                              <button
                                onClick={()=>{
                                  const pairs:QAPair[] = spec.questions.map((q,i)=>({q,a:qaAnswers[i]??''}))
                                  generateSpec(req,pairs)
                                }}
                                disabled={genSpec||Object.keys(qaAnswers).length===0||atLimit}
                                style={{background:atLimit?'var(--fog)':'#0A5C46',color:atLimit?'var(--slate)':'var(--white)',border:'none',borderRadius:8,padding:'9px 18px',cursor:atLimit?'not-allowed':'pointer',fontFamily:'var(--font-body)',fontSize:13,fontWeight:500,opacity:Object.keys(qaAnswers).length===0||atLimit?0.5:1}}
                              >
                                {genSpec?'✦ Regenerating…':atLimit?'✕ Regeneration limit reached':'✦ Regenerate with Answers'}
                              </button>
                              <button onClick={()=>{setShowQAP(false);setQAAnswers({})}} style={sBTN}>Cancel</button>
                              </>
                            })()}</div>
                            {specErr&&<p style={{color:'#A32D2D',fontSize:11,marginTop:6}}>{specErr}</p>}
                          </div>
                        ):(
                          <div>
                            <ol style={{margin:'0 0 12px',paddingLeft:20,display:'flex',flexDirection:'column',gap:6}}>
                              {spec.questions.map((q,i)=><li key={i} style={{fontFamily:'var(--font-body)',fontSize:13,color:'var(--ink)',lineHeight:1.65}}>{q}</li>)}
                            </ol>
                            {(req.status==='draft'||req.status==='needs_clarification'||req.status==='quote_rejected'||isSuperadmin)&&(
                              <button onClick={()=>setShowQAP(true)} style={{background:'rgba(200,149,42,0.12)',border:'1px solid rgba(200,149,42,0.3)',color:'#7A5200',borderRadius:8,padding:'8px 16px',cursor:'pointer',fontFamily:'var(--font-body)',fontSize:12,fontWeight:500}}>
                                Answer questions &amp; refine spec →
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {spec.notes&&(
                      <Sect title="Technical Notes">
                        <p style={{fontFamily:'var(--font-body)',fontSize:12,color:'var(--slate)',lineHeight:1.65}}>{spec.notes}</p>
                      </Sect>
                    )}
                  </div>
                </div>
              ):(
                <div style={{...crd,textAlign:'center',padding:'22px 20px'}}>
                  {feasLoadingId===req.id ? null : genSpec ? (
                    <>
                      <div style={{fontSize:28,marginBottom:10}}>✦</div>
                      <p style={{fontFamily:'var(--font-mono)',fontSize:11,color:'var(--forest)',letterSpacing:'0.1em',marginBottom:6}}>Generating AI spec…</p>
                      <p style={{fontFamily:'var(--font-body)',fontSize:12,color:'var(--slate)',lineHeight:1.6}}>
                        {'Analysing your requirement as a senior ' + erpLabel + ' consultant.'} This takes 10–20 seconds.
                      </p>
                    </>
                  ) : (
                    <>
                      <div style={{fontSize:28,marginBottom:10}}>✦</div>
                      <p style={{fontFamily:'var(--font-body)',fontSize:13,color:'var(--slate)',marginBottom:14,lineHeight:1.65}}>
                        No spec generated yet. This can happen if generation failed on creation.
                      </p>
                      {specErr&&<p style={{color:'#A32D2D',fontSize:12,marginBottom:10}}>{specErr}</p>}
                      <button onClick={()=>generateSpec(req)} style={{background:'var(--ink)',color:'var(--cream)',border:'none',borderRadius:8,padding:'10px 22px',cursor:'pointer',fontFamily:'var(--font-body)',fontSize:13,fontWeight:500}}>
                        ↺ Retry Generation
                      </button>
                    </>
                  )}
                  </div>
                </div>
              )}

              {/* Payment Terms Notice — shown when a quote is present and not yet accepted */}
              {req.quote && req.status === 'quoted' && !isSuperadmin && (()=>{
                const q = parseFloat(req.quote)
                const termsKey = req.tenant.paymentTermsKey
                const reviewCredit = req.reviewPaidAt ? 249 : 0
                const depositGross = Math.round(q * 0.2 * 100) / 100
                const depositNet   = Math.max(0, Math.round((depositGross - reviewCredit) * 100) / 100)
                const depositGstAmt = Math.round(depositNet * 0.15 * 100) / 100
                const depositTotal  = Math.round((depositNet + depositGstAmt) * 100) / 100
                const balanceExcl  = Math.round((q - depositGross) * 100) / 100
                return (
                  <div style={{background:'rgba(200,149,42,0.06)',border:'1px solid rgba(200,149,42,0.2)',borderRadius:10,padding:'14px 16px'}}>
                    <p style={{fontFamily:'var(--font-mono)',fontSize:8,letterSpacing:'0.12em',textTransform:'uppercase',color:'#9A6A00',marginBottom:10}}>📋 Payment Terms</p>
                    {[
                      {label:'Total project quote (plus GST)', val:`$${q.toLocaleString('en-NZ',{minimumFractionDigits:2})} NZD`, style:{}},
                      ...(reviewCredit ? [{label:'Spec review fee — credited', val:`− $${reviewCredit.toFixed(2)} NZD`, style:{color:'var(--forest)'}}] : []),
                      {label:'20% deposit (plus GST)', val:`$${depositNet.toLocaleString('en-NZ',{minimumFractionDigits:2})} NZD`, style:{}},
                      {label:'GST (15%)', val:`$${depositGstAmt.toFixed(2)} NZD`, style:{}},
                      {label:'Deposit due now (incl. GST)', val:`$${depositTotal.toFixed(2)} NZD`, style:{fontWeight:700,color:'#7A5200'}},
                      {label:`80% balance (plus GST) — due ${isMonthlyBilling(termsKey)?'20th of following month':'on completion'}`, val:`$${balanceExcl.toLocaleString('en-NZ',{minimumFractionDigits:2})} NZD`, style:{color:'var(--slate)'}},
                    ].map((r,i,arr)=>(
                      <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'5px 0',borderBottom:i<arr.length-1?'1px solid rgba(200,149,42,0.12)':'none'}}>
                        <span style={{fontFamily:'var(--font-body)',fontSize:12,color:'var(--slate)',...r.style}}>{r.label}</span>
                        <span style={{fontFamily:'var(--font-mono)',fontSize:12,...r.style}}>{r.val}</span>
                      </div>
                    ))}
                    <p style={{fontFamily:'var(--font-mono)',fontSize:8,color:'var(--slate)',marginTop:8,paddingTop:8,borderTop:'1px solid rgba(200,149,42,0.12)',letterSpacing:'0.04em'}}>
                      All prices exclude GST (15%). GST is added at payment and shown on your invoice.
                    </p>
                  </div>
                )
              })()}

              {/* Quote */}
              {req.quote&&(
                <div style={{...crd,background:req.quoteApprovedAt?'rgba(10,92,70,0.04)':'var(--white)',borderColor:req.quoteApprovedAt?'rgba(10,92,70,0.2)':'var(--fog)'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:isCardCollapsed('quote-'+req.id) ? 0 : 8}}>
                    <label style={{...lbl,marginBottom:0}}>Quote from BespoxAI</label>
                    <CardToggleBtn collapsed={!!isCardCollapsed('quote-'+req.id)} onToggle={()=>toggleCard('quote-'+req.id)} />
                  </div>
                  <div style={{overflow:'hidden',maxHeight:isCardCollapsed('quote-'+req.id) ? 0 : '9999px',transition:'max-height 0.25s ease'}}>
                  <div style={{display:'flex',alignItems:'baseline',gap:6}}>
                    <span style={{fontFamily:'var(--font-display)',fontSize:30,fontWeight:500,color:'var(--forest)',lineHeight:1}}>${parseFloat(req.quote).toLocaleString()}</span>
                    <span style={{fontFamily:'var(--font-mono)',fontSize:10,color:'var(--slate)'}}>NZD plus GST</span>
                  </div>
                  {req.consultantNote&&<div style={{fontFamily:'var(--font-body)',fontSize:12,lineHeight:1.7,marginTop:10}}>{renderMdLight(req.consultantNote)}</div>}
                  {req.quoteApprovedAt&&<p style={{fontFamily:'var(--font-mono)',fontSize:9,color:'var(--jade)',marginTop:8,letterSpacing:'0.08em'}}>✓ Accepted {new Date(req.quoteApprovedAt).toLocaleDateString('en-NZ',{dateStyle:'medium'})}</p>}
                  {req.depositAmount&&(
                    <div style={{marginTop:12,paddingTop:12,borderTop:'1px solid var(--fog)',display:'flex',gap:20,flexWrap:'wrap'}}>
                      <div>
                        <div style={{fontFamily:'var(--font-mono)',fontSize:8,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--slate)',marginBottom:3}}>20% Deposit</div>
                        <div style={{display:'flex',alignItems:'center',gap:8}}>
                          <span style={{fontFamily:'var(--font-mono)',fontSize:13,fontWeight:600,color:'var(--ink)'}}>${parseFloat(req.depositAmount).toLocaleString('en-NZ',{minimumFractionDigits:2})}</span>
                          {req.depositPaidAt
                            ? <span style={{fontFamily:'var(--font-mono)',fontSize:8,color:'var(--jade)',background:'rgba(26,146,114,0.1)',border:'1px solid rgba(26,146,114,0.25)',borderRadius:4,padding:'1px 6px'}}>✓ PAID {new Date(req.depositPaidAt).toLocaleDateString('en-NZ',{dateStyle:'short'})}</span>
                            : <span style={{fontFamily:'var(--font-mono)',fontSize:8,color:'#9A6A00',background:'rgba(200,149,42,0.1)',border:'1px solid rgba(200,149,42,0.25)',borderRadius:4,padding:'1px 6px'}}>DUE</span>
                          }
                        </div>
                      </div>
                      <div>
                        <div style={{fontFamily:'var(--font-mono)',fontSize:8,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--slate)',marginBottom:3}}>80% Balance on Completion</div>
                        <div style={{display:'flex',alignItems:'center',gap:8}}>
                          <span style={{fontFamily:'var(--font-mono)',fontSize:13,fontWeight:600,color:'var(--ink)'}}>${(parseFloat(req.quote)-parseFloat(req.depositAmount)).toLocaleString('en-NZ',{minimumFractionDigits:2})}</span>
                          {req.balancePaidAt
                            ? <span style={{fontFamily:'var(--font-mono)',fontSize:8,color:'var(--jade)',background:'rgba(26,146,114,0.1)',border:'1px solid rgba(26,146,114,0.25)',borderRadius:4,padding:'1px 6px'}}>✓ PAID {new Date(req.balancePaidAt).toLocaleDateString('en-NZ',{dateStyle:'short'})}</span>
                            : <span style={{fontFamily:'var(--font-mono)',fontSize:8,color:'var(--slate)',background:'rgba(59,82,73,0.06)',border:'1px solid var(--fog)',borderRadius:4,padding:'1px 6px'}}>{req.depositPaidAt?'DUE ON COMPLETION':'PENDING'}</span>
                          }
                        </div>
                      </div>
                    </div>
                  )}
                  </div>
                </div>
              )}

              {/* Review payment status — shown when review has been paid/included/bypassed */}
              {(req.reviewPaidAt||req.reviewIncluded||req.reviewBypassed)&&req.status!=='draft'&&(
                <div style={{background:'rgba(26,146,114,0.06)',border:'1px solid rgba(26,146,114,0.2)',borderRadius:8,padding:'10px 14px',display:'flex',alignItems:'center',gap:10}}>
                  <span style={{fontSize:14,flexShrink:0}}>{req.reviewBypassed?'🔓':req.reviewIncluded?'🎁':'✅'}</span>
                  <div>
                    <p style={{fontFamily:'var(--font-mono)',fontSize:8,letterSpacing:'0.12em',textTransform:'uppercase',color:'var(--jade)',marginBottom:2}}>
                      {req.reviewBypassed?'Review fee waived':'Review fee '+(req.reviewIncluded?'included with plan':'paid')}
                    </p>
                    <p style={{fontFamily:'var(--font-body)',fontSize:11,color:'var(--slate)',margin:0,lineHeight:1.5}}>
                      {req.reviewBypassed
                        ?'A senior developer will review this specification before a quote is issued.'
                        :req.reviewIncluded
                          ?'Covered by your plan. A senior developer will review this specification before a quote is issued.'
                          :'$249 NZD (plus GST) review fee paid. This will be credited against development costs. A senior developer will review before a quote is issued.'}
                    </p>
                  </div>
                </div>
              )}

              {/* Fully paid banner */}
              {req.status==='fully_paid'&&(
                <div style={{background:'rgba(26,146,114,0.08)',border:'1px solid rgba(26,146,114,0.25)',borderRadius:10,padding:'14px 16px',display:'flex',alignItems:'center',gap:10}}>
                  <span style={{fontSize:20}}>🎉</span>
                  <div>
                    <p style={{fontFamily:'var(--font-mono)',fontSize:9,letterSpacing:'0.12em',textTransform:'uppercase',color:'#0F6E56',marginBottom:3}}>Fully paid — complete</p>
                    <p style={{fontFamily:'var(--font-body)',fontSize:12,color:'var(--slate)',lineHeight:1.5}}>Your customisation is complete and fully paid. BespoxAI will arrange delivery with your team.</p>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
                {!isSuperadmin&&req.status==='draft'&&<>
                  {req.parentId ? (
                    spec ? (
                      <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
                        <button onClick={()=>patch(req.id,{status:'submitted'})} disabled={actLoading} style={pBTN}>Submit Addendum for Review →</button>
                        <button onClick={()=>deleteReq(req.id)} style={{...sBTN,color:'#A32D2D'}}>Delete</button>
                      </div>
                    ) : (
                      <button onClick={()=>deleteReq(req.id)} style={{...sBTN,color:'#A32D2D'}}>Delete</button>
                    )
                  ) : spec ? (
                    <div style={{display:'flex',flexDirection:'column',gap:10,flex:'0 0 auto'}}>
                      <div style={{background:'rgba(10,92,70,0.04)',border:'1px solid rgba(10,92,70,0.15)',borderRadius:8,padding:'12px 14px'}}>
                        <p style={{fontFamily:'var(--font-mono)',fontSize:8,letterSpacing:'0.12em',textTransform:'uppercase',color:'var(--forest)',marginBottom:5}}>Senior Developer Review — {reviewAllowance&&reviewAllowance.remaining>0?'Included with your plan':'$249 NZD plus GST'}</p>
                        <p style={{fontFamily:'var(--font-body)',fontSize:12,color:'var(--slate)',lineHeight:1.6,margin:0}}>
                          {'Every specification is reviewed by a senior ' + erpLabel + ' developer before a quote is issued.'}
                          {reviewAllowance&&reviewAllowance.remaining>0
                            ? ` You have ${reviewAllowance.remaining} included review${reviewAllowance.remaining!==1?'s':''} remaining this month.`
                            : ' This fee is credited in full against development costs if you proceed.'}
                        </p>
                      </div>
                      <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
                        <button onClick={()=>submitForReview(req)} disabled={reviewLoading} style={{...pBTN,opacity:reviewLoading?0.7:1}}>
                          {reviewLoading?'Processing…':reviewAllowance&&reviewAllowance.remaining>0?'Submit for Senior Review (included) →':'Submit for Senior Review — $249 + GST →'}
                        </button>
                        {(!reviewAllowance||reviewAllowance.remaining===0)&&(
                          <p style={{fontFamily:'var(--font-mono)',fontSize:8,color:'var(--slate)',marginTop:4}}>$249.00 plus GST · 15% GST ($37.35) added at checkout · credited against development deposit</p>
                        )}
                        <button onClick={()=>deleteReq(req.id)} style={{...sBTN,color:'#A32D2D'}}>Delete Draft</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button onClick={()=>patch(req.id,{status:'submitted'})} disabled={actLoading} style={pBTN}>Submit for Review →</button>
                      <button onClick={()=>deleteReq(req.id)} style={{...sBTN,color:'#A32D2D'}}>Delete Draft</button>
                    </>
                  )}
                </>}

                {!isSuperadmin&&req.status==='submitted'&&!!req.parentId&&(
                  <div style={{background:'rgba(10,92,70,0.04)',border:'1px solid rgba(10,92,70,0.15)',borderRadius:8,padding:'12px 14px'}}>
                    <p style={{fontFamily:'var(--font-mono)',fontSize:8,letterSpacing:'0.12em',textTransform:'uppercase',color:'var(--forest)',marginBottom:4}}>Submitted for Review</p>
                    <p style={{fontFamily:'var(--font-body)',fontSize:12,color:'var(--slate)',lineHeight:1.6,margin:0}}>
                      BespoxAI will review this addendum and issue a separate quote. Use the refine panel above to clarify anything in the meantime.
                    </p>
                  </div>
                )}
                {!isSuperadmin&&req.status==='quoted'&&<>
                  <button onClick={()=>openDepositModal(req)} style={{...pBTN,background:'#085040'}}>{requiresDeposit(req.tenant.paymentTermsKey) ? '✓ Accept Quote & Proceed' : '✓ Accept & Begin Development'}</button>
                  <button onClick={()=>{setShowRQ(true)}} style={{background:'rgba(163,45,45,0.08)',border:'1px solid rgba(163,45,45,0.2)',color:'#A32D2D',borderRadius:8,padding:'9px 16px',cursor:'pointer',fontFamily:'var(--font-body)',fontSize:13}}>
                    ✕ Reject Quote
                  </button>
                </>}
                {isSuperadmin&&req.status==='draft'&&spec&&(
                  <button onClick={()=>submitForReview(req)} disabled={reviewLoading} style={{...pBTN,background:'#3B5249',opacity:reviewLoading?0.7:1}}>
                    {reviewLoading?'Processing…':'↪ Bypass Review Fee & Submit'}
                  </button>
                )}
                {isSuperadmin&&req.status==='submitted'&&<>
                  <button onClick={()=>patch(req.id,{status:'in_review'})} disabled={actLoading} style={pBTN}>→ Mark In Review</button>
                  <button onClick={()=>{setShowSB(true);setShowQF(false)}} style={{background:'rgba(163,45,45,0.08)',border:'1px solid rgba(163,45,45,0.2)',color:'#A32D2D',borderRadius:8,padding:'9px 16px',cursor:'pointer',fontFamily:'var(--font-body)',fontSize:13}}>↩ Send Back with Questions</button>
                </>}
                {isSuperadmin&&req.status==='in_review'&&<>
                  <button onClick={()=>{setShowQF(true);setShowSB(false)}} disabled={actLoading} style={pBTN}>$ Add Quote</button>
                  <button onClick={()=>{setShowSB(true);setShowQF(false)}} style={{background:'rgba(163,45,45,0.08)',border:'1px solid rgba(163,45,45,0.2)',color:'#A32D2D',borderRadius:8,padding:'9px 16px',cursor:'pointer',fontFamily:'var(--font-body)',fontSize:13}}>↩ Send Back</button>
                </>}
                {isSuperadmin&&req.status==='quote_rejected'&&(
                  <button onClick={()=>{setShowQF(true);setShowSB(false)}} disabled={actLoading} style={pBTN}>$ Revise Quote</button>
                )}
                {!isSuperadmin&&req.status==='deposit_required'&&(
                  <button onClick={()=>openDepositModal(req)} style={{...pBTN,background:'#085040'}}>
                    💳 Pay Deposit Now
                  </button>
                )}
                {!isSuperadmin&&req.status==='complete_pending_payment'&&(
                  <button onClick={()=>openBalanceModal(req)} style={{...pBTN,background:'#7A5200'}}>
                    💳 {isMonthlyBilling(req.tenant.paymentTermsKey) ? 'View Payment Details' : 'Pay Balance Now'}
                  </button>
                )}
                {/* ── Documents section (customer) ─────────────────────────── */}
                {!isSuperadmin && req.quote && ['deposit_required','deposit_paid','in_development','complete_pending_payment','fully_paid'].includes(req.status) && (
                  <div style={{width:'100%',borderTop:'1px solid var(--fog)',paddingTop:14,marginTop:4}}>
                    <p style={{fontFamily:'var(--font-mono)',fontSize:8,letterSpacing:'0.12em',textTransform:'uppercase',color:'var(--slate)',marginBottom:10}}>Documents</p>
                    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                      {/* Deposit invoice */}
                      <button
                        onClick={()=>{
                          const depositAmt = Math.max(0, (parseFloat(req.quote!)*0.2) - (req.reviewPaidAt ? 249 : 0))
                          const paidViaStripe = !!(req.depositStripeSessionId)
                          generateInvoicePDF(req, '', depositAmt.toFixed(2), true, paidViaStripe ? 'stripe' : 'bank_transfer', req.depositPaidAt)
                        }}
                        style={{background:'var(--white)',border:'1px solid var(--fog)',color:'var(--ink)',borderRadius:7,padding:'7px 12px',cursor:'pointer',fontFamily:'var(--font-body)',fontSize:12,display:'flex',alignItems:'center',gap:6}}
                      >
                        <span style={{fontSize:14}}>📄</span> Deposit Invoice
                      </button>
                      {/* Review invoice */}
                      {req.reviewPaidAt && (
                        <button
                          onClick={()=>{ setReviewPoReq(req); setReviewPo('') }}
                          style={{background:'var(--white)',border:'1px solid var(--fog)',color:'var(--ink)',borderRadius:7,padding:'7px 12px',cursor:'pointer',fontFamily:'var(--font-body)',fontSize:12,display:'flex',alignItems:'center',gap:6}}
                        >
                          <span style={{fontSize:14}}>📄</span> Review Invoice
                        </button>
                      )}
                      {/* Balance invoice — once fully paid */}
                      {req.balancePaidAt && req.status === 'fully_paid' && (
                        <button
                          onClick={()=>{
                            const depositAmt = parseFloat(req.depositAmount ?? '0')
                            const balanceAmt = (parseFloat(req.quote!)-depositAmt).toFixed(2)
                            const paidViaStripe = !!(req.balanceStripeSessionId)
                            generateInvoicePDF(req, '', balanceAmt, false, paidViaStripe ? 'stripe' : 'bank_transfer', req.balancePaidAt)
                          }}
                          style={{background:'var(--white)',border:'1px solid var(--fog)',color:'var(--ink)',borderRadius:7,padding:'7px 12px',cursor:'pointer',fontFamily:'var(--font-body)',fontSize:12,display:'flex',alignItems:'center',gap:6}}
                        >
                          <span style={{fontSize:14}}>📄</span> Balance Invoice
                        </button>
                      )}
                      {/* Go-live document — once customer has approved go-live */}
                      {req.prodGoLiveDoc && req.prodApprovalSentAt && (
                        <button
                          onClick={()=>{
                            const blob = new Blob([req.prodGoLiveDoc!], { type: 'text/plain' })
                            const url = URL.createObjectURL(blob)
                            const a = document.createElement('a')
                            a.href = url
                            a.download = 'go-live-' + req.id.slice(0,8) + '.txt'
                            a.click()
                            URL.revokeObjectURL(url)
                          }}
                          style={{background:'var(--white)',border:'1px solid var(--fog)',color:'var(--ink)',borderRadius:7,padding:'7px 12px',cursor:'pointer',fontFamily:'var(--font-body)',fontSize:12,display:'flex',alignItems:'center',gap:6}}
                        >
                          <span style={{fontSize:14}}>📄</span> Go-Live Document
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {isSuperadmin&&req.status==='deposit_required'&&(
                  <button onClick={()=>patch(req.id,{status:'deposit_paid'})} disabled={actLoading} style={{...pBTN,background:'#0F6E56'}}>✓ Confirm Deposit Received</button>
                )}
                {isSuperadmin&&req.status==='deposit_paid'&&(
                  <button onClick={()=>patch(req.id,{status:'in_development'})} disabled={actLoading} style={pBTN}>→ Start Development</button>
                )}
                {isSuperadmin&&req.status==='in_development'&&(
                  <button onClick={()=>patch(req.id,{status:'complete_pending_payment'})} disabled={actLoading} style={{...pBTN,background:'#0F6E56'}}>✓ Mark Complete — Request Balance</button>
                )}

                {/* ── UAT Panel (customer-facing when test env is deployed) ── */}
                {!isSuperadmin&&(req.status==='in_uat'||req.status==='uat_rejected'||req.status==='uat_confirmed')&&(
                  <div style={{...crd,borderColor:req.uatApprovedAt?'rgba(10,92,70,0.3)':req.uatRejectedAt?'rgba(163,45,45,0.3)':'rgba(200,149,42,0.3)',background:req.uatApprovedAt?'rgba(10,92,70,0.04)':req.uatRejectedAt?'rgba(163,45,45,0.04)':'rgba(200,149,42,0.04)',marginTop:12}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:isCardCollapsed('uat-'+req.id) ? 0 : 10}}>
                    <span style={{fontFamily:'var(--font-mono)',fontSize:9,letterSpacing:'0.12em',textTransform:'uppercase',color:req.uatApprovedAt?'#0A5C46':req.uatRejectedAt?'#A32D2D':'#9A6A00'}}>{req.uatApprovedAt?'UAT Approved':req.uatRejectedAt?'UAT Rejected':'UAT Ready'}</span>
                    <CardToggleBtn collapsed={!!isCardCollapsed('uat-'+req.id)} onToggle={()=>toggleCard('uat-'+req.id)} />
                  </div>
                  <div style={{overflow:'hidden',maxHeight:isCardCollapsed('uat-'+req.id) ? 0 : '9999px',transition:'max-height 0.25s ease'}}>
                    {req.uatApprovedAt?(
                      <div>
                        <p style={{fontFamily:'var(--font-mono)',fontSize:10,color:'#0A5C46',fontWeight:600,marginBottom:4}}>✓ UAT Approved</p>
                        <p style={{fontFamily:'var(--font-body)',fontSize:11,color:'var(--slate)',margin:0}}>Signed off {new Date(req.uatApprovedAt).toLocaleDateString('en-NZ')} — awaiting production deployment.</p>
                      </div>
                    ):req.uatRejectedAt?(
                      <div>
                        <p style={{fontFamily:'var(--font-mono)',fontSize:10,color:'#A32D2D',fontWeight:600,marginBottom:4}}>✕ UAT Rejected — New deployment cycle in progress</p>
                        <p style={{fontFamily:'var(--font-body)',fontSize:11,color:'var(--slate)',margin:0}}>Our team has been notified and will address the issues raised.</p>
                      </div>
                    ):(
                      <div>
                        <p style={{fontFamily:'var(--font-mono)',fontSize:10,color:'#9A6A00',fontWeight:600,letterSpacing:'0.08em',marginBottom:6}}>🧪 TEST ENVIRONMENT READY</p>
                        <p style={{fontFamily:'var(--font-body)',fontSize:12,color:'var(--ink)',lineHeight:1.6,marginBottom:4}}>Your customisation has been deployed to the test environment. Please test thoroughly and sign off when satisfied.</p>
                        <p style={{fontFamily:'var(--font-body)',fontSize:11,color:'var(--slate)',marginBottom:12}}>Deployed to test: {req.testDeployedAt ? new Date(req.testDeployedAt).toLocaleDateString('en-NZ') : '—'}</p>

                        {/* Scope-creep analysis result */}
                        {uatScopeCreep&&(
                          <div style={{background:'rgba(163,45,45,0.06)',border:'1px solid rgba(163,45,45,0.2)',borderRadius:6,padding:'10px 12px',marginBottom:12}}>
                            <p style={{fontFamily:'var(--font-mono)',fontSize:9,color:'#A32D2D',fontWeight:600,marginBottom:6}}>SCOPE ASSESSMENT</p>
                            <p style={{fontFamily:'var(--font-body)',fontSize:12,color:'var(--ink)',lineHeight:1.6,marginBottom:6}}>{uatScopeCreep.explanation}</p>
                            {uatScopeCreep.suggestedAmendment&&(
                              <p style={{fontFamily:'var(--font-body)',fontSize:11,color:'var(--slate)',marginBottom:8}}><strong>Amendment would cover:</strong> {uatScopeCreep.suggestedAmendment}</p>
                            )}
                            <div style={{display:'flex',gap:8}}>
                              <button
                                onClick={async()=>{
                                  const r=await fetch(`/api/requirements/${req.id}/uat-reject`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason:uatRejectReason,confirm:true})})
                                  if(r.ok){setUATScopeCreep(null);setShowUATReject(false);setUATRejectReason('');const d=await r.json();setReqs(prev=>prev.map(x=>x.id===req.id?{...x,status:'uat_rejected',uatRejectedAt:d.rejectedAt,testDeployedAt:null}:x))}
                                }}
                                style={{...sBTN,fontSize:11,color:'#A32D2D'}}
                              >Reject anyway</button>
                              <button onClick={()=>{setUATScopeCreep(null);setShowUATReject(false);setUATRejectReason('')}} style={{...pBTN,fontSize:11}}>Request amendment instead</button>
                            </div>
                          </div>
                        )}

                        {showUATReject&&!uatScopeCreep&&(
                          <div style={{marginBottom:12}}>
                            <textarea
                              value={uatRejectReason}
                              onChange={e=>setUATRejectReason(e.target.value)}
                              placeholder="Please describe what is not working or what needs to change…"
                              rows={3}
                              style={{width:'100%',fontFamily:'var(--font-body)',fontSize:12,padding:'8px 10px',borderRadius:6,border:'1px solid var(--fog)',resize:'vertical',boxSizing:'border-box'}}
                            ></textarea>
                            <div style={{display:'flex',gap:8,marginTop:6}}>
                              <button
                                disabled={!uatRejectReason.trim()||uatRejectLoading}
                                onClick={async()=>{
                                  setUATRejectLoad(true)
                                  try{
                                    const r=await fetch(`/api/requirements/${req.id}/uat-reject`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason:uatRejectReason})})
                                    const d=await r.json()
                                    if(d.isScopeCreep){setUATScopeCreep({explanation:d.explanation,suggestedAmendment:d.suggestedAmendment})}
                                    else if(d.rejected){setShowUATReject(false);setUATRejectReason('');setReqs(prev=>prev.map(x=>x.id===req.id?{...x,status:'uat_rejected',uatRejectedAt:d.rejectedAt,testDeployedAt:null}:x))}
                                  }finally{setUATRejectLoad(false)}
                                }}
                                style={{...sBTN,fontSize:11,color:'#A32D2D'}}
                              >{uatRejectLoading?'Checking…':'Submit Rejection'}</button>
                              <button onClick={()=>{setShowUATReject(false);setUATRejectReason('');setUATScopeCreep(null)}} style={{...pBTN,fontSize:11,background:'var(--fog)',color:'var(--ink)'}}>Cancel</button>
                            </div>
                          </div>
                        )}

                        {!showUATReject&&!uatScopeCreep&&(
                          <div style={{display:'flex',gap:8}}>
                            <button
                              disabled={uatApproveLoading}
                              onClick={async()=>{
                                if(!confirm('Sign off UAT? This confirms the customisation has been tested and is ready for production deployment.'))return
                                setUATApproveLoad(true)
                                try{
                                  const r=await fetch(`/api/requirements/${req.id}/uat-approve`,{method:'POST'})
                                  if(r.ok){const d=await r.json();setReqs(prev=>prev.map(x=>x.id===req.id?{...x,status:'uat_confirmed',uatApprovedAt:d.approvedAt}:x))}
                                }finally{setUATApproveLoad(false)}
                              }}
                              style={{...pBTN,background:'#0A5C46',color:'var(--cream)',fontSize:12}}
                            >{uatApproveLoading?'Signing off…':'✓ Sign Off UAT'}</button>
                            <button onClick={()=>{setShowUATReject(true);setUATScopeCreep(null)}} style={{...sBTN,fontSize:12,color:'#A32D2D'}}>✕ Reject</button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  </div>
                </div>
                )}
                {/* ── Production Deployment — go-live doc & approval (customer) ── */}
                {!isSuperadmin&&req.prodApprovalSentAt&&!req.prodDeployedAt&&(
                  <div style={{...crd,borderColor:req.prodApprovedAt?'rgba(10,92,70,0.3)':'rgba(200,149,42,0.3)',background:req.prodApprovedAt?'rgba(10,92,70,0.04)':'rgba(200,149,42,0.04)',marginTop:12}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:isCardCollapsed('proddep-'+req.id) ? 0 : 10}}>
                    <span style={{fontFamily:'var(--font-mono)',fontSize:9,letterSpacing:'0.12em',textTransform:'uppercase',color:req.prodApprovedAt?'#0A5C46':'#9A6A00'}}>{req.prodApprovedAt?'Go-Live Approved':'Production Go-Live Approval Required'}</span>
                    <CardToggleBtn collapsed={!!isCardCollapsed('proddep-'+req.id)} onToggle={()=>toggleCard('proddep-'+req.id)} />
                  </div>
                  <div style={{overflow:'hidden',maxHeight:isCardCollapsed('proddep-'+req.id) ? 0 : '9999px',transition:'max-height 0.25s ease'}}>
                    {req.prodApprovedAt?(
                      <div>
                        <p style={{fontFamily:'var(--font-mono)',fontSize:10,color:'#0A5C46',fontWeight:600,marginBottom:4}}>✓ Go-Live Approved</p>
                        <p style={{fontFamily:'var(--font-body)',fontSize:11,color:'var(--slate)',margin:0}}>Approved {''+new Date(req.prodApprovedAt).toLocaleDateString('en-NZ')+''} — our team will schedule the production deployment shortly.</p>
                      </div>
                    ):(
                      <div>
                        <p style={{fontFamily:'var(--font-mono)',fontSize:10,color:'#9A6A00',fontWeight:600,letterSpacing:'0.08em',marginBottom:8}}>PRODUCTION GO-LIVE APPROVAL REQUIRED</p>
                        <p style={{fontFamily:'var(--font-body)',fontSize:12,color:'var(--ink)',lineHeight:1.6,marginBottom:12}}>Please review the go-live document below and approve when you are ready to proceed with production deployment.</p>
                        {req.prodGoLiveDoc&&(
                          <div style={{background:'var(--white)',border:'1px solid rgba(200,149,42,0.2)',borderRadius:6,padding:'14px 16px',marginBottom:14,fontSize:13,lineHeight:1.75,color:'var(--ink)',whiteSpace:'pre-wrap'}}>
                            {req.prodGoLiveDoc}
                          </div>
                        )}
                        <button
                          onClick={async()=>{
                            if(!confirm('Approve production deployment? This confirms you have reviewed the go-live document and are ready for the changes to go live.'))return
                            const r=await fetch('/api/requirements/'+req.id+'/prod-approve',{method:'POST'})
                            if(r.ok){const d=await r.json();setReqs(prev=>prev.map(x=>x.id===req.id?{...x,prodApprovedAt:d.approvedAt}:x))}
                          }}
                          style={{...pBTN,background:'#0A5C46',color:'var(--cream)',fontSize:12}}
                        >✓ Approve Go-Live</button>
                      </div>
                    )}
                  </div>
                  </div>
                </div>
                )}

                {/* Production deployed confirmation */}
                {!isSuperadmin&&req.prodDeployedAt&&(
                  <div style={{...crd,borderColor:'rgba(10,92,70,0.35)',background:'rgba(10,92,70,0.05)',marginTop:12}}>
                    <p style={{fontFamily:'var(--font-mono)',fontSize:10,color:'#0A5C46',fontWeight:600,marginBottom:4}}>🚀 Live in Production</p>
                    <p style={{fontFamily:'var(--font-body)',fontSize:11,color:'var(--slate)',margin:0}}>{'Deployed '+new Date(req.prodDeployedAt).toLocaleDateString('en-NZ')+'. Your customisation is now live in Business Central.'}</p>
                  </div>
                )}

                {isSuperadmin&&req.status==='complete_pending_payment'&&(
                  <button onClick={()=>patch(req.id,{status:'fully_paid'})} disabled={actLoading} style={{...pBTN,background:'#085040'}}>✓ Confirm Balance Received</button>
                )}
                {isSuperadmin&&req.status==='needs_clarification'&&(
                  <p style={{fontFamily:'var(--font-mono)',fontSize:10,color:'var(--slate)',alignSelf:'center'}}>Waiting for customer response…</p>
                )}
                {isSuperadmin&&!['fully_paid','rejected'].includes(req.status)&&(
                  <button onClick={()=>patch(req.id,{status:'rejected'})} disabled={actLoading} style={{...sBTN,color:'#A32D2D'}}>✕ Reject</button>
                )}

                {/* ── Addenda list ── */}
                {req.addenda && req.addenda.length > 0 ? (
                  <div style={{borderTop:'1px solid var(--fog)',paddingTop:12}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:isCardCollapsed('addenda-'+req.id) ? 0 : 6}}>
                      <p style={{fontFamily:'var(--font-mono)',fontSize:8,letterSpacing:'0.12em',textTransform:'uppercase',color:'var(--slate)',margin:0}}>Addenda ({req.addenda.length})</p>
                      <CardToggleBtn collapsed={!!isCardCollapsed('addenda-'+req.id)} onToggle={()=>toggleCard('addenda-'+req.id)} />
                    </div>
                    <div style={{overflow:'hidden',maxHeight:isCardCollapsed('addenda-'+req.id) ? 0 : '9999px',transition:'max-height 0.25s ease',display:'flex',flexDirection:'column',gap:6}}>
                    {req.addenda.map(add => {
                      const sc = STATUS_COLOR[add.status] ?? STATUS_COLOR.draft
                      return (
                        <button
                          key={add.id}
                          onClick={()=>{ const full = reqs.find(r=>r.id===add.id); if(full) selectReq(full) }}
                          style={{display:'flex',alignItems:'center',gap:8,padding:'8px 10px',borderRadius:6,background:'var(--white)',border:'1px solid var(--fog)',cursor:'pointer',textAlign:'left',width:'100%'}}
                        >
                          <span style={{fontFamily:'var(--font-body)',fontSize:12,color:'var(--ink)',flex:1,lineHeight:1.3}}>{add.title}</span>
                          <span style={{fontFamily:'var(--font-mono)',fontSize:8,letterSpacing:'0.07em',textTransform:'uppercase',color:sc.text,background:sc.bg,border:`1px solid ${sc.border}`,padding:'2px 7px',borderRadius:6,whiteSpace:'nowrap'}}>{add.status.replace(/_/g,' ')}</span>
                          {add.quote ? <span style={{fontFamily:'var(--font-mono)',fontSize:9,color:'var(--forest)',whiteSpace:'nowrap',fontWeight:600}}>${parseFloat(add.quote).toLocaleString()}</span> : null}
                          <span style={{fontFamily:'var(--font-mono)',fontSize:9,color:'var(--slate)'}}>→</span>
                        </button>
                      )
                    })}
                    </div>
                  </div>
                ) : null}

                {/* ── Add Addendum — opens full create page ── */}
                {!isSuperadmin && ['deposit_paid','in_development'].includes(req.status) ? (
                  <button
                    onClick={()=>{ setAddendumParentId(req.id); setAddendumParentTitle(req.title); setAddendumForm({title:'',description:'',bcArea:req.bcArea,priority:req.priority}); setAddendumErr(''); setShowAddendum(true); clearReq(); setShowCreate(false) }}
                    style={{...sBTN,fontSize:12,color:'var(--forest)',borderColor:'rgba(10,92,70,0.25)',alignSelf:'flex-start'}}
                  >+ Add Addendum</button>
                ) : null}
              </div>

              {/* Deployed Objects — superadmin upload after fully_paid */}
              {isSuperadmin&&req.status==='fully_paid'&&(
                <div style={{...crd,borderColor:'rgba(10,92,70,0.2)',background:'rgba(10,92,70,0.02)'}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
                    <label style={{...lbl,marginBottom:0,color:'var(--forest)'}}>{erpLabel} Objects Deployed</label>
                    <button
                      onClick={()=>objInputRef.current?.click()}
                      disabled={objUploading}
                      style={{...pBTN,padding:'6px 14px',fontSize:12,opacity:objUploading?0.6:1}}
                    >
                      {objUploading?'Parsing...':'+ Upload Object Files'}
                    </button>
                    <input
                      ref={objInputRef}
                      type="file"
                      multiple
                      accept=".txt,.al"
                      style={{display:'none'}}
                      onChange={e=>{ if(e.target.files?.length) { uploadObjects(req.id,e.target.files); e.target.value='' } }}
                    />
                  </div>
                  <p style={{fontFamily:'var(--font-body)',fontSize:11,color:'var(--slate)',lineHeight:1.55,marginBottom:objFiles.length?12:0}}>
                    {objFiles.length===0
                      ? 'Upload the delivered .al or C/AL .txt object files. The AI will use these to avoid conflicts in future requirements for this customer.'
                      : `${objFiles.length} object${objFiles.length!==1?'s':''} on record for this tenant.`}
                  </p>
                  {objFiles.length>0&&(
                    <div style={{display:'flex',flexDirection:'column',gap:6}}>
                      {objFiles.map((obj:any)=>(
                        <div key={obj.id} style={{display:'flex',alignItems:'center',gap:8,background:obj.parseError?'rgba(163,45,45,0.04)':'var(--cream)',border:`1px solid ${obj.parseError?'rgba(163,45,45,0.2)':'var(--fog)'}`,borderRadius:7,padding:'7px 10px'}}>
                          <span style={{fontFamily:'var(--font-mono)',fontSize:8,letterSpacing:'0.08em',textTransform:'uppercase',color:obj.parseError?'#A32D2D':'var(--forest)',background:obj.parseError?'rgba(163,45,45,0.08)':'rgba(10,92,70,0.08)',border:`1px solid ${obj.parseError?'rgba(163,45,45,0.2)':'rgba(10,92,70,0.2)'}`,borderRadius:4,padding:'2px 6px',flexShrink:0}}>
                            {obj.parseError?'parse err':obj.objectType}
                          </span>
                          {obj.objectId&&<span style={{fontFamily:'var(--font-mono)',fontSize:10,color:'var(--slate)',flexShrink:0}}>#{obj.objectId}</span>}
                          <span style={{fontFamily:'var(--font-body)',fontSize:12,color:'var(--ink)',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{obj.objectName}</span>
                          <span style={{fontFamily:'var(--font-mono)',fontSize:8,color:'var(--slate)',flexShrink:0}}>{obj.language}</span>
                          <button onClick={()=>deleteObjFile(req.id,obj.id)} style={{background:'none',border:'none',cursor:'pointer',color:'rgba(163,45,45,0.5)',fontSize:14,padding:'0 2px',lineHeight:1,flexShrink:0}} title="Remove">✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Balance due banner (customer) */}
              {!isSuperadmin&&req.status==='complete_pending_payment'&&(
                <div style={{background:'rgba(200,149,42,0.07)',border:'1px solid rgba(200,149,42,0.3)',borderRadius:10,padding:'16px 18px'}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
                    <span style={{fontSize:16}}>🎉</span>
                    <span style={{fontFamily:'var(--font-mono)',fontSize:9,letterSpacing:'0.12em',textTransform:'uppercase',color:'#7A5200',fontWeight:600}}>Your customisation is complete</span>
                  </div>
                  <p style={{fontFamily:'var(--font-body)',fontSize:13,color:'var(--ink)',lineHeight:1.65,marginBottom:14}}>
                    Please pay the remaining balance
                    {req.depositAmount&&req.quote ? <strong> ${(parseFloat(req.quote)-parseFloat(req.depositAmount)).toLocaleString('en-NZ',{minimumFractionDigits:2})} NZD</strong> : ''}
                    {' '}to receive delivery of your customisation.
                  </p>
                  <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
                    <button onClick={()=>openBalanceModal(req)} style={{...pBTN,background:'#7A5200',display:'flex',alignItems:'center',gap:8}}>
                      💳 Pay Balance Now
                    </button>
                  </div>
                </div>
              )}


              {/* Send back form */}
              {showSendBack&&isSuperadmin&&(
                <div style={{...crd,borderColor:'rgba(163,45,45,0.25)',background:'rgba(163,45,45,0.03)'}}>
                  <label style={{...lbl,color:'#A32D2D'}}>Questions / Notes for Customer</label>
                  <p style={{fontFamily:'var(--font-body)',fontSize:11,color:'var(--slate)',marginBottom:10,lineHeight:1.5}}>The customer will see this and must respond before resubmitting.</p>
                  <textarea placeholder={'e.g.\n1. Should approval apply to all orders or only above a threshold?\n2. Who are the approvers — named users or a BC permission group?\n3. Do you need email notifications, and what should they contain?'} value={sendBackText} onChange={e=>setSBT(e.target.value)} rows={6} style={{...iSt,resize:'vertical',lineHeight:1.65,marginBottom:10}} onFocus={fo} onBlur={bl}/>
                  <div style={{display:'flex',gap:8}}>
                    <button onClick={sendBack} disabled={!sendBackText.trim()||actLoading} style={{...pBTN,background:'#A32D2D',opacity:!sendBackText.trim()?0.6:1}}>↩ Send Back to Customer</button>
                    <button onClick={()=>{setShowSB(false);setSBT('')}} style={sBTN}>Cancel</button>
                  </div>
                </div>
              )}

              {/* Quote form */}
              {showQF&&isSuperadmin&&(
                <div style={{...crd,borderColor:'rgba(10,92,70,0.25)',background:'rgba(10,92,70,0.03)'}}>
                  <label style={lbl}>{req.status==='quote_rejected'?'Revised Quote':'Add Quote'}</label>
                  {req.status==='quote_rejected'&&req.quoteRejectionReason&&(
                    <p style={{fontFamily:'var(--font-body)',fontSize:11,color:'var(--slate)',marginBottom:12,lineHeight:1.5,fontStyle:'italic'}}>Customer reason: "{req.quoteRejectionReason}"</p>
                  )}
                  <div style={{marginBottom:10}}>
                    <div style={{...lbl,marginBottom:5}}>Amount (NZD plus GST)</div>
                    <input type="number" placeholder="e.g. 2500" value={quoteAmt} onChange={e=>setQA(e.target.value)} style={iSt} onFocus={fo} onBlur={bl}/>
                  </div>
                  <div style={{...lbl,marginBottom:5}}>Note to customer (optional)</div>
                  <textarea placeholder="e.g. Revised to a reduced scope per your feedback — basic approval flow without email notifications." value={quoteNote} onChange={e=>setQN(e.target.value)} rows={3} style={{...iSt,resize:'vertical',marginBottom:12}} onFocus={fo} onBlur={bl}/>
                  <div style={{display:'flex',gap:8}}>
                    <button onClick={submitQuote} disabled={!quoteAmt||actLoading} style={{...pBTN,opacity:!quoteAmt?0.6:1}}>Send Quote →</button>
                    <button onClick={()=>setShowQF(false)} style={sBTN}>Cancel</button>
                  </div>
                </div>
              )}

              <p style={{fontFamily:'var(--font-mono)',fontSize:9,color:'var(--slate)',letterSpacing:'0.07em'}}>
                Created {new Date(req.createdAt).toLocaleString('en-NZ',{dateStyle:'medium',timeStyle:'short'})}
                {req.updatedAt!==req.createdAt&&` · Updated ${new Date(req.updatedAt).toLocaleString('en-NZ',{dateStyle:'medium',timeStyle:'short'})}`}
              </p>
            </>
          })()}
        </div>
      )}

      {/* ── Payment Modal (deposit + balance) ────────────────────────────── */}
      {showPayModal && payingReq && payingReq.quote && (()=>{
        const req       = payingReq
        const isDeposit = payFlow === 'deposit'
        const termsKey  = req.tenant.paymentTermsKey
        const quote     = parseFloat(req.quote ?? '0')
        const reviewCredit = isDeposit && req.reviewPaidAt ? 249 : 0
        const baseAmt   = isDeposit
          ? Math.max(0, Math.round((quote * 0.2 - reviewCredit) * 100) / 100)
          : Math.round((quote - parseFloat(req.depositAmount ?? '0')) * 100) / 100
        const gstAmt    = Math.round(baseAmt * GST_RATE * 100) / 100
        const totalInclGst = Math.round((baseAmt + gstAmt) * 100) / 100
        const isIntl    = isIntlCountry(req.tenant.country)
        const fees      = calcSurcharge(totalInclGst, isIntl)
        const accentColor = isDeposit ? '#085040' : '#7A5200'
        const accentBg    = isDeposit ? 'rgba(10,92,70,0.05)' : 'rgba(200,149,42,0.05)'
        const accentBdr   = isDeposit ? 'rgba(10,92,70,0.18)' : 'rgba(200,149,42,0.25)'
        // Terms 3 deposit: no payment needed — show confirm only
        const isAutoAdvance = isDeposit && !requiresDeposit(termsKey)
        // Terms 2/3 balance: bank transfer only
        const isBankOnly = !isDeposit && isMonthlyBilling(termsKey)
        // Due date for monthly billing
        const now = new Date()
        const dueDate = new Date(now.getFullYear(), now.getMonth() + 1, 20).toLocaleDateString('en-NZ', { dateStyle: 'long' })
        const termsText = bizConfig ? getTermsText(bizConfig, termsKey) : ''
        return (
          <div style={{position:'fixed',inset:0,background:'rgba(4,14,9,0.6)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:24}}>
            <div style={{background:'var(--white)',borderRadius:16,padding:'28px 32px',width:560,maxWidth:'100%',boxShadow:'0 8px 40px rgba(4,14,9,0.22)'}}>

              {/* Header */}
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
                <h2 style={{fontFamily:'var(--font-display)',fontSize:20,fontWeight:500,color:'var(--ink)',margin:0}}>
                  {isAutoAdvance ? 'Accept & Begin Development' : isDeposit ? 'Accept Quote & Pay Deposit' : 'Pay Balance'}
                </h2>
                <button onClick={closePayModal} style={{background:'none',border:'none',cursor:'pointer',color:'var(--slate)',fontSize:20,lineHeight:1}}>✕</button>
              </div>

              {/* Amount summary */}
              <div style={{background:accentBg,border:`1px solid ${accentBdr}`,borderRadius:10,padding:'14px 16px',marginBottom:20}}>
                {(isDeposit ? [
                  {label:'Total project quote (plus GST)', amt:`$${quote.toLocaleString('en-NZ',{minimumFractionDigits:2})} NZD`, bold:false, credit:false},
                  ...(reviewCredit ? [{label:'Spec review fee — credited', amt:`− $249.00 NZD`, bold:false, credit:true}] : []),
                  {label:'20% deposit (plus GST)', amt:`$${baseAmt.toLocaleString('en-NZ',{minimumFractionDigits:2})} NZD`, bold:false, credit:false},
                  {label:'GST (15%)', amt:`$${gstAmt.toLocaleString('en-NZ',{minimumFractionDigits:2})} NZD`, bold:false, credit:false},
                  {label:'Total deposit incl. GST', amt:`$${totalInclGst.toLocaleString('en-NZ',{minimumFractionDigits:2})} NZD`, bold:true, credit:false},
                ] : [
                  {label:'Total project quote (plus GST)', amt:`$${quote.toLocaleString('en-NZ',{minimumFractionDigits:2})} NZD`, bold:false, credit:false},
                  {label:'Deposit paid', amt:`$${parseFloat(req.depositAmount??'0').toLocaleString('en-NZ',{minimumFractionDigits:2})} NZD`, bold:false, credit:false},
                  {label:'Balance (plus GST)', amt:`$${baseAmt.toLocaleString('en-NZ',{minimumFractionDigits:2})} NZD`, bold:false, credit:false},
                  {label:'GST (15%)', amt:`$${gstAmt.toLocaleString('en-NZ',{minimumFractionDigits:2})} NZD`, bold:false, credit:false},
                  {label:'Total balance incl. GST', amt:`$${totalInclGst.toLocaleString('en-NZ',{minimumFractionDigits:2})} NZD`, bold:true, credit:false},
                ]).map((r,i,arr)=>(
                  <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'5px 0',borderBottom:i<arr.length-1?`1px solid ${accentBdr}`:'none'}}>
                    <span style={{fontFamily:'var(--font-body)',fontSize:12,color:r.credit?'var(--forest)':'var(--slate)'}}>{r.label}</span>
                    <span style={{fontFamily:'var(--font-mono)',fontSize:r.bold?14:12,fontWeight:r.bold?700:400,color:r.bold?accentColor:r.credit?'var(--forest)':'var(--ink)'}}>{r.amt}</span>
                  </div>
                ))}
                {isBankOnly && (
                  <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${accentBdr}`,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <span style={{fontFamily:'var(--font-mono)',fontSize:9,letterSpacing:'0.08em',textTransform:'uppercase',color:accentColor}}>Payment due</span>
                    <span style={{fontFamily:'var(--font-mono)',fontSize:12,fontWeight:700,color:accentColor}}>{dueDate}</span>
                  </div>
                )}
              </div>

              {/* Terms 3 deposit — accept only, no payment */}
              {isAutoAdvance && (
                <div style={{display:'flex',flexDirection:'column',gap:12,marginBottom:20}}>
                  <div style={{background:'rgba(10,92,70,0.05)',border:'1px solid rgba(10,92,70,0.18)',borderRadius:10,padding:'14px 16px'}}>
                    <p style={{fontFamily:'var(--font-body)',fontSize:13,color:'var(--ink)',lineHeight:1.65,margin:0}}>
                      Development will begin immediately upon acceptance, under your account payment terms: <strong>{termsText}</strong>.
                    </p>
                  </div>
                  <div style={{background:'rgba(163,45,45,0.05)',border:'1px solid rgba(163,45,45,0.2)',borderRadius:10,padding:'14px 16px'}}>
                    <p style={{fontFamily:'var(--font-mono)',fontSize:8,letterSpacing:'0.12em',textTransform:'uppercase',color:'#A32D2D',marginBottom:8,fontWeight:600}}>⚠ Important — Please Read</p>
                    <ul style={{fontFamily:'var(--font-body)',fontSize:12,color:'var(--ink)',lineHeight:1.75,paddingLeft:16,margin:0}}>
                      <li>By proceeding, you accept full liability for the <strong>20% deposit ({reviewCredit ? `$${Math.max(0,quote*0.2-249).toLocaleString('en-NZ',{minimumFractionDigits:2})}` : `$${(quote*0.2).toLocaleString('en-NZ',{minimumFractionDigits:2})}`} NZD)</strong> even if you cancel before work is complete.</li>
                      <li style={{marginTop:6}}>If you cancel <strong>after 24 hours</strong> from acceptance, you are liable for the <strong>full development cost (${quote.toLocaleString('en-NZ',{minimumFractionDigits:2})} NZD plus GST)</strong>.</li>
                      <li style={{marginTop:6}}>An invoice will be issued for the balance due on the 20th of the following month.</li>
                    </ul>
                  </div>
                </div>
              )}

              {/* Terms 2/3 balance — bank only */}
              {isBankOnly && (
                <div style={{marginBottom:16}}>
                  <p style={{fontFamily:'var(--font-body)',fontSize:13,color:'var(--slate)',marginBottom:12}}>
                    As per your payment terms, balance is due by bank transfer on <strong>{dueDate}</strong>. Download your invoice below.
                  </p>
                  <div style={{marginBottom:12}}>
                    <label style={{fontFamily:'var(--font-mono)',fontSize:9,letterSpacing:'0.14em',textTransform:'uppercase',color:'var(--slate)',display:'block',marginBottom:6}}>
                      PO Number / Reference <span style={{fontWeight:400,textTransform:'none',letterSpacing:0}}>(optional)</span>
                    </label>
                    <input value={poNumber} onChange={e=>setPoNumber(e.target.value)}
                      placeholder="e.g. PO-2026-0042"
                      style={{width:'100%',background:'var(--cream)',border:'1px solid var(--fog)',borderRadius:8,padding:'9px 12px',fontSize:13,fontFamily:'var(--font-body)',color:'var(--ink)',outline:'none',boxSizing:'border-box'}}
                      onFocus={e=>(e.target.style.borderColor=accentColor)}
                      onBlur={e=>(e.target.style.borderColor='var(--fog)')}
                    />
                  </div>
                </div>
              )}

              {/* Terms 1/2 deposit — payment method selector */}
              {!isAutoAdvance && !isBankOnly && (
                <>
                  <p style={{fontFamily:'var(--font-body)',fontSize:13,color:'var(--slate)',marginBottom:12}}>How would you like to pay?</p>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:16}}>
                    <button onClick={()=>setPaymentMode('stripe')} style={{padding:'14px',borderRadius:10,border:`2px solid ${paymentMode==='stripe'?accentColor:'var(--fog)'}`,background:paymentMode==='stripe'?accentBg:'var(--white)',cursor:'pointer',textAlign:'left',transition:'all 0.15s'}}>
                      <div style={{fontSize:22,marginBottom:6}}>💳</div>
                      <div style={{fontFamily:'var(--font-body)',fontSize:13,fontWeight:600,color:'var(--ink)',marginBottom:3}}>Pay by Card</div>
                      <div style={{fontFamily:'var(--font-mono)',fontSize:9,color:'var(--slate)',letterSpacing:'0.04em'}}>Instant · {isIntl?'3.50%':'2.65%'} + NZ$0.30 fee</div>
                      {paymentMode==='stripe'&&(
                        <div style={{marginTop:8,padding:'8px 10px',background:'rgba(0,0,0,0.04)',borderRadius:7}}>
                          <div style={{display:'flex',justifyContent:'space-between',fontFamily:'var(--font-mono)',fontSize:10}}>
                            <span style={{color:'var(--slate)'}}>Amount incl. GST</span>
                            <span style={{color:'var(--ink)'}}>${totalInclGst.toFixed(2)}</span>
                          </div>
                          <div style={{display:'flex',justifyContent:'space-between',fontFamily:'var(--font-mono)',fontSize:10,marginTop:3}}>
                            <span style={{color:'var(--slate)'}}>Card processing fee</span>
                            <span style={{color:'var(--slate)'}}>${fees.fee.toFixed(2)}</span>
                          </div>
                          <div style={{display:'flex',justifyContent:'space-between',fontFamily:'var(--font-mono)',fontSize:11,fontWeight:700,marginTop:5,paddingTop:5,borderTop:'1px solid rgba(0,0,0,0.08)'}}>
                            <span style={{color:'var(--ink)'}}>Total you pay</span>
                            <span style={{color:accentColor}}>${fees.total.toFixed(2)} NZD</span>
                          </div>
                        </div>
                      )}
                    </button>
                    <button onClick={()=>setPaymentMode('invoice')} style={{padding:'14px',borderRadius:10,border:`2px solid ${paymentMode==='invoice'?accentColor:'var(--fog)'}`,background:paymentMode==='invoice'?accentBg:'var(--white)',cursor:'pointer',textAlign:'left',transition:'all 0.15s'}}>
                      <div style={{fontSize:22,marginBottom:6}}>📄</div>
                      <div style={{fontFamily:'var(--font-body)',fontSize:13,fontWeight:600,color:'var(--ink)',marginBottom:3}}>Bank Transfer</div>
                      <div style={{fontFamily:'var(--font-mono)',fontSize:9,color:'var(--slate)',letterSpacing:'0.04em'}}>Download invoice · No card fee</div>
                      {paymentMode==='invoice'&&(
                        <div style={{marginTop:8,padding:'8px 10px',background:'rgba(0,0,0,0.04)',borderRadius:7}}>
                          <div style={{display:'flex',justifyContent:'space-between',fontFamily:'var(--font-mono)',fontSize:11,fontWeight:700}}>
                            <span style={{color:'var(--ink)'}}>Total you pay</span>
                            <span style={{color:accentColor}}>${totalInclGst.toFixed(2)} NZD</span>
                          </div>
                        </div>
                      )}
                    </button>
                  </div>
                  {paymentMode==='invoice'&&(
                    <div style={{marginBottom:16}}>
                      <label style={{fontFamily:'var(--font-mono)',fontSize:9,letterSpacing:'0.14em',textTransform:'uppercase',color:'var(--slate)',display:'block',marginBottom:6}}>
                        PO Number / Reference <span style={{fontWeight:400,textTransform:'none',letterSpacing:0}}>(optional)</span>
                      </label>
                      <input value={poNumber} onChange={e=>setPoNumber(e.target.value)}
                        placeholder="e.g. PO-2026-0042"
                        style={{width:'100%',background:'var(--cream)',border:'1px solid var(--fog)',borderRadius:8,padding:'9px 12px',fontSize:13,fontFamily:'var(--font-body)',color:'var(--ink)',outline:'none',boxSizing:'border-box'}}
                        onFocus={e=>(e.target.style.borderColor=accentColor)}
                        onBlur={e=>(e.target.style.borderColor='var(--fog)')}
                      />
                    </div>
                  )}
                </>
              )}

              {/* Actions */}
              <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
                <button onClick={closePayModal} style={sBTN}>Cancel</button>
                {isAutoAdvance && (
                  <button onClick={()=>handleStripePayment(req,false)} disabled={payLoading} style={{...pBTN,background:accentColor,opacity:payLoading?0.7:1}}>
                    {payLoading?'Processing…':'✓ Accept & Begin Development →'}
                  </button>
                )}
                {isBankOnly && (
                  <button onClick={()=>handleInvoiceDownload(req,poNumber)} disabled={payLoading} style={{...pBTN,background:accentColor,opacity:payLoading?0.7:1}}>
                    {payLoading?'Generating…':'↓ Download Invoice PDF'}
                  </button>
                )}
                {!isAutoAdvance && !isBankOnly && paymentMode==='stripe' && (
                  <button onClick={()=>handleStripePayment(req,true)} disabled={payLoading} style={{...pBTN,background:accentColor,opacity:payLoading?0.7:1}}>
                    {payLoading?'Redirecting…':`Pay $${fees.total.toFixed(2)} NZD →`}
                  </button>
                )}
                {!isAutoAdvance && !isBankOnly && paymentMode==='invoice' && (
                  <button onClick={()=>handleInvoiceDownload(req,poNumber)} disabled={payLoading} style={{...pBTN,background:accentColor,opacity:payLoading?0.7:1}}>
                    {payLoading?'Generating…':'↓ Download Invoice PDF'}
                  </button>
                )}
              </div>

            </div>
          </div>
        )
      })()}

      {/* ── Review Invoice PO Modal ─────────────────────────────────────── */}
      {reviewPoReq && (
        <div style={{position:'fixed',inset:0,background:'rgba(4,14,9,0.6)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:24}}>
          <div style={{background:'var(--white)',borderRadius:14,padding:'24px 28px',width:400,maxWidth:'100%',boxShadow:'0 8px 40px rgba(4,14,9,0.22)'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
              <h3 style={{fontFamily:'var(--font-display)',fontSize:18,fontWeight:500,color:'var(--ink)',margin:0}}>Review Invoice</h3>
              <button onClick={()=>setReviewPoReq(null)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--slate)',fontSize:20}}>✕</button>
            </div>
            <label style={{display:'block',fontFamily:'var(--font-mono)',fontSize:9,letterSpacing:'0.14em',textTransform:'uppercase',color:'var(--slate)',marginBottom:6}}>
              PO Number / Reference <span style={{fontWeight:400,textTransform:'none',letterSpacing:0}}>(optional)</span>
            </label>
            <input
              value={reviewPo}
              onChange={e=>setReviewPo(e.target.value)}
              onKeyDown={e=>{ if(e.key==='Enter'){ generateReviewInvoicePDF(reviewPoReq,reviewPo); setReviewPoReq(null) }}}
              placeholder="e.g. PO-2026-0042"
              autoFocus
              style={{width:'100%',background:'var(--cream)',border:'1px solid var(--fog)',borderRadius:8,padding:'9px 12px',fontSize:13,fontFamily:'var(--font-body)',color:'var(--ink)',outline:'none',boxSizing:'border-box'}}
              onFocus={e=>(e.target.style.borderColor='var(--forest)')}
              onBlur={e=>(e.target.style.borderColor='var(--fog)')}
            />
            <div style={{display:'flex',gap:10,justifyContent:'flex-end',marginTop:16}}>
              <button onClick={()=>setReviewPoReq(null)} style={sBTN}>Cancel</button>
              <button onClick={()=>{ generateReviewInvoicePDF(reviewPoReq,reviewPo); setReviewPoReq(null) }} style={{...pBTN,background:'var(--forest)'}}>
                ↓ Download Invoice
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
    </div>
  )
}

function Sect({title,titleColor,children}:{title:string;titleColor?:string;children:React.ReactNode}) {
  return (
    <div>
      <div style={{fontFamily:'var(--font-mono)',fontSize:8,letterSpacing:'0.14em',textTransform:'uppercase',color:titleColor??'var(--slate)',marginBottom:7,display:'flex',alignItems:'center',gap:6}}>
        {title}<div style={{flex:1,height:1,background:'var(--fog)'}}/>
      </div>
      {children}
    </div>
  )
}

const crd:React.CSSProperties={background:'var(--white)',border:'1px solid var(--fog)',borderRadius:10,padding:'16px 18px'}
const lbl:React.CSSProperties={display:'block',fontFamily:'var(--font-mono)',fontSize:9,letterSpacing:'0.14em',textTransform:'uppercase',color:'var(--slate)',marginBottom:8}
const selSt:React.CSSProperties={background:'var(--white)',border:'1px solid var(--fog)',borderRadius:8,padding:'7px 10px',fontSize:12,fontFamily:'var(--font-body)',color:'var(--ink)',outline:'none',cursor:'pointer'}
const pBTN:React.CSSProperties={background:'var(--forest)',color:'var(--white)',border:'none',borderRadius:8,padding:'9px 18px',cursor:'pointer',fontFamily:'var(--font-body)',fontSize:13,fontWeight:500}
const sBTN:React.CSSProperties={background:'var(--fog)',color:'var(--ink)',border:'none',borderRadius:8,padding:'9px 16px',cursor:'pointer',fontFamily:'var(--font-body)',fontSize:13}
const xBTN:React.CSSProperties={background:'none',border:'none',cursor:'pointer',color:'var(--slate)',fontSize:18,padding:'4px 8px',lineHeight:1,flexShrink:0}

function cxBg(c:string){return c==='Simple'?'rgba(26,146,114,0.08)':c==='Medium'?'rgba(200,149,42,0.08)':'rgba(163,45,45,0.06)'}
function cxCol(c:string){return c==='Simple'?'#0F6E56':c==='Medium'?'#C8952A':'#A32D2D'}
function cxBdr(c:string){return c==='Simple'?'rgba(26,146,114,0.25)':c==='Medium'?'rgba(200,149,42,0.25)':'rgba(163,45,45,0.2)'}

