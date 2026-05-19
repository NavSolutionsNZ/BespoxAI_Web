'use client'

import { useState, useEffect, useRef } from 'react'

export interface Requirement {
  id: string; tenantId: string; userId: string; title: string; description: string
  bcArea: string; priority: string; aiSpec: string | null; status: string
  quote: string | null; quoteApprovedAt: string | null; consultantNote: string | null
  depositAmount: string | null; depositPaidAt: string | null; balancePaidAt: string | null
  adminQuestions: string | null; customerAnswers: string | null; adminQALog: string | null
  quoteRejectedAt: string | null; quoteRejectionReason: string | null
  feasibility: string | null; feasibilityNotes: string | null
  feasibilityCostRange: string | null; feasibilityCheckedAt: string | null
  reviewPaidAt: string | null; reviewStripeSessionId: string | null
  reviewBypassed: boolean; reviewIncluded: boolean; reviewSubmittedAt: string | null
  createdAt: string; updatedAt: string
  user: { name: string | null; email: string }
  tenant: { name: string }
}

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
  {key:'in_development',label:'In Development'},{key:'complete_pending_payment',label:'Balance Due'},
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
  complete_pending_payment: {bg:'rgba(200,149,42,0.1)',  border:'rgba(200,149,42,0.3)', text:'#7A5200'},
  fully_paid:               {bg:'rgba(26,146,114,0.12)', border:'rgba(26,146,114,0.35)',text:'#0A5240'},
  rejected:                 {bg:'rgba(163,45,45,0.14)', border:'rgba(163,45,45,0.45)',  text:'#8B1A1A'},
}
function statusLabel(s:string) {
  const map:Record<string,string> = {
    needs_clarification:'Needs Clarification', quote_rejected:'Quote Rejected',
    deposit_required:'Deposit Required', deposit_paid:'Deposit Paid',
    in_development:'In Development', complete_pending_payment:'Balance Due',
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

interface Props { userRole:string; tenantId:string; bcConnected?:boolean }

export default function RequirementsBuilder({ userRole, tenantId, bcConnected=false }:Props) {
  const isSuperadmin = userRole === 'superadmin'
  const [reqs, setReqs]             = useState<Requirement[]>([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState('')
  const [selected, setSelected]     = useState<Requirement|null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [filterStatus, setFS]       = useState('all')
  const [filterArea, setFA]         = useState('all')

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
    setSelected(req); setShowCreate(false)
    setShowQAP(false); setQAAnswers({})
    setShowRefine(false); setRefinementText(''); setEditedUS(''); setEditedCrit([])
    setAAD(''); setShowSB(false); setShowQF(false)
    setSpecErr(''); setFeasErr(''); setShowRQ(false); setRejectReason('')
    setRF({title:req.title,description:req.description,bcArea:req.bcArea,priority:req.priority,extraContext:''})
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
    if (selected?.id===id) setSelected(null)
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
    if (filterStatus!=='all'&&r.status!==filterStatus) return false
    if (filterArea!=='all'&&r.bcArea!==filterArea) return false
    return true
  })
  const needsClarifCount = reqs.filter(r=>r.status==='needs_clarification').length
  const quoteRejCount    = reqs.filter(r=>r.status==='quote_rejected').length
  const panelOpen = selected||showCreate

  const iSt:React.CSSProperties = {width:'100%',background:'var(--cream)',border:'1px solid var(--fog)',borderRadius:8,padding:'9px 12px',fontSize:13,fontFamily:'var(--font-body)',color:'var(--ink)',outline:'none',boxSizing:'border-box'}
  const fo = (e:any) => e.target.style.borderColor='var(--forest)'
  const bl = (e:any) => e.target.style.borderColor='var(--fog)'

  if (loading) return <div style={{padding:40,textAlign:'center',color:'var(--slate)',fontFamily:'var(--font-mono)',fontSize:12}}>Loading requirements…</div>
  if (error)   return <div style={{padding:40,textAlign:'center'}}><p style={{color:'#A32D2D',fontFamily:'var(--font-body)',fontSize:13,marginBottom:10}}>{error}</p><button onClick={load} style={sBTN}>Retry</button></div>

  return (
    <div style={{flex:1,display:'flex',overflow:'hidden'}}>

      {/* ── Left list ─────────────────────────────────────────────────────── */}
      <div style={{width:panelOpen?360:'100%',flexShrink:0,display:'flex',flexDirection:'column',borderRight:panelOpen?'1px solid var(--fog)':'none',overflow:'hidden',transition:'width 0.2s'}}>
        <div style={{padding:'12px 14px',borderBottom:'1px solid var(--fog)',display:'flex',gap:8,background:'var(--white)',alignItems:'center',flexWrap:'wrap'}}>
          <button onClick={()=>{setShowCreate(true);setSelected(null)}} style={pBTN}>+ New Request</button>
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
            <span style={{marginLeft:'auto',fontFamily:'var(--font-mono)',fontSize:7,letterSpacing:'0.08em',textTransform:'uppercase',color:'var(--slate)',background:'rgba(59,82,73,0.05)',border:'1px solid var(--fog)',padding:'2px 8px',borderRadius:20,cursor:'default'}} title="Connect your BC instance in Settings for AI-assisted planning">
              🔌 BC not connected
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
              <div style={{fontSize:32,marginBottom:12}}>📋</div>
              <p style={{fontFamily:'var(--font-body)',fontSize:13,color:'var(--slate)',lineHeight:1.6}}>
                {reqs.length===0?'No customisation requests yet.\nClick "+ New Request" to get started.':'No requests match your filters.'}
              </p>
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
                  {spec&&<span style={{fontFamily:'var(--font-mono)',fontSize:8,color:'var(--jade)'}}>✦ spec</span>}
                  {(spec?.questions?.length??0)>0&&<span style={{fontFamily:'var(--font-mono)',fontSize:8,color:'#C8952A'}}>? {spec!.questions.length}q</span>}
                  {req.quote&&<span style={{fontFamily:'var(--font-mono)',fontSize:9,color:'var(--forest)',fontWeight:600}}>${parseFloat(req.quote).toLocaleString()}</span>}
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
                  {req.status!=='draft'&&req.reviewPaidAt&&(
                    <span style={{fontFamily:'var(--font-mono)',fontSize:8,color:'var(--forest)',background:'rgba(10,92,70,0.08)',border:'1px solid rgba(10,92,70,0.18)',padding:'1px 6px',borderRadius:4}}>✓ review paid</span>
                  )}
                  {req.status!=='draft'&&req.reviewIncluded&&!req.reviewPaidAt&&(
                    <span style={{fontFamily:'var(--font-mono)',fontSize:8,color:'var(--jade)',background:'rgba(26,146,114,0.08)',border:'1px solid rgba(26,146,114,0.2)',padding:'1px 6px',borderRadius:4}}>✓ included in plan</span>
                  )}
                  {req.status!=='draft'&&req.reviewBypassed&&!req.reviewPaidAt&&!req.reviewIncluded&&(
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
                <label style={lbl}>BC Area</label>
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
                  <h2 style={{fontFamily:'var(--font-display)',fontSize:21,fontWeight:500,color:'var(--ink)',lineHeight:1.3,marginBottom:10}}>{req.title}</h2>
                  <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                    <span style={{fontFamily:'var(--font-mono)',fontSize:9,letterSpacing:'0.1em',textTransform:'uppercase',color:sc.text,background:sc.bg,border:`1px solid ${sc.border}`,padding:'3px 10px',borderRadius:20}}>{statusLabel(req.status)}</span>
                    <span style={{fontFamily:'var(--font-mono)',fontSize:9,letterSpacing:'0.1em',textTransform:'uppercase',color:prio.color,background:prio.bg,border:`1px solid ${prio.border}`,padding:'3px 10px',borderRadius:20}}>{prio.label}</span>
                    <span style={{fontFamily:'var(--font-mono)',fontSize:10,color:'var(--slate)'}}>{req.bcArea}</span>
                    {isSuperadmin&&<span style={{fontFamily:'var(--font-mono)',fontSize:10,color:'var(--jade)'}}>{req.tenant.name} · {req.user.name??req.user.email}</span>}
                  </div>
                </div>
                <button onClick={()=>setSelected(null)} style={xBTN}>✕</button>
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
                        <label style={lbl}>BC Area</label>
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
                  <div style={{fontFamily:'var(--font-mono)',fontSize:9,letterSpacing:'0.14em',textTransform:'uppercase',color:'var(--slate)',marginBottom:12,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <span>BespoxAI Feasibility Check</span>
                    {req.feasibilityCheckedAt&&<span style={{color:'rgba(59,82,73,0.5)',fontSize:8}}>{new Date(req.feasibilityCheckedAt).toLocaleDateString('en-NZ',{dateStyle:'medium'})}</span>}
                  </div>

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
              )}

              {/* Pipeline */}
              {!['needs_clarification','rejected','quote_rejected'].includes(req.status)&&req.status!=='fully_paid'&&(
                <div style={crd}>
                  <label style={lbl}>Progress</label>
                  <div style={{display:'flex',alignItems:'center',marginTop:6}}>
                    {STATUS_PIPELINE.map((s,i)=>{
                      const done=i<si,cur=i===si
                      return (
                        <div key={s.key} style={{display:'flex',alignItems:'center',flex:i<STATUS_PIPELINE.length-1?1:'none'}}>
                          <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
                            <div style={{width:18,height:18,borderRadius:'50%',background:done?'var(--jade)':cur?'var(--forest)':'var(--fog)',boxShadow:cur?'0 0 0 3px rgba(10,92,70,0.15)':'none',display:'flex',alignItems:'center',justifyContent:'center'}}>
                              {done&&<span style={{color:'white',fontSize:9}}>✓</span>}
                            </div>
                            <span style={{fontFamily:'var(--font-mono)',fontSize:7,letterSpacing:'0.07em',textTransform:'uppercase',color:cur?'var(--forest)':done?'var(--jade)':'var(--slate)',textAlign:'center',whiteSpace:'nowrap'}}>{s.label}</span>
                          </div>
                          {i<STATUS_PIPELINE.length-1&&<div style={{flex:1,height:2,background:done?'var(--jade)':'var(--fog)',margin:'0 2px',marginBottom:18}}/>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Description */}
              <div style={crd}>
                <label style={lbl}>Description</label>
                <p style={{fontFamily:'var(--font-body)',fontSize:13,color:'var(--ink)',lineHeight:1.75,whiteSpace:'pre-wrap'}}>{req.description}</p>

                {/* Q&A context — show question + answer pairs */}
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
                    {(req.status==='draft'||req.status==='needs_clarification'||req.status==='quote_rejected'||isSuperadmin)&&(()=>{
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
                      <Sect title="BC Objects Affected">
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
                        {(req.status==='draft'||req.status==='needs_clarification'||req.status==='quote_rejected'||isSuperadmin)&&showQAPanel?(
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
                  {genSpec ? (
                    <>
                      <div style={{fontSize:28,marginBottom:10}}>✦</div>
                      <p style={{fontFamily:'var(--font-mono)',fontSize:11,color:'var(--forest)',letterSpacing:'0.1em',marginBottom:6}}>Generating AI spec…</p>
                      <p style={{fontFamily:'var(--font-body)',fontSize:12,color:'var(--slate)',lineHeight:1.6}}>
                        Analysing your requirement as a senior BC consultant. This takes 10–20 seconds.
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
              )}

              {/* Payment Terms Notice — shown when a quote is present and not yet accepted */}
              {req.quote && req.status === 'quoted' && !isSuperadmin && (
                <div style={{background:'rgba(200,149,42,0.06)',border:'1px solid rgba(200,149,42,0.2)',borderRadius:10,padding:'14px 16px'}}>
                  <p style={{fontFamily:'var(--font-mono)',fontSize:8,letterSpacing:'0.12em',textTransform:'uppercase',color:'#9A6A00',marginBottom:8}}>📋 Payment Terms</p>
                  <p style={{fontFamily:'var(--font-body)',fontSize:12,color:'var(--ink)',lineHeight:1.7}}>
                    Accepting this quote requires a <strong>20% deposit</strong> ({req.quote ? `$${(parseFloat(req.quote)*0.2).toLocaleString('en-NZ',{minimumFractionDigits:2,maximumFractionDigits:2})} NZD` : ''}) payable before development begins.
                    The remaining <strong>80% balance</strong> is due on completion, prior to delivery of the customisation.
                  </p>
                </div>
              )}

              {/* Quote */}
              {req.quote&&(
                <div style={{...crd,background:req.quoteApprovedAt?'rgba(10,92,70,0.04)':'var(--white)',borderColor:req.quoteApprovedAt?'rgba(10,92,70,0.2)':'var(--fog)'}}>
                  <label style={lbl}>Quote from BespoxAI</label>
                  <div style={{display:'flex',alignItems:'baseline',gap:6}}>
                    <span style={{fontFamily:'var(--font-display)',fontSize:30,fontWeight:500,color:'var(--forest)',lineHeight:1}}>${parseFloat(req.quote).toLocaleString()}</span>
                    <span style={{fontFamily:'var(--font-mono)',fontSize:10,color:'var(--slate)'}}>NZD excl. GST</span>
                  </div>
                  {req.consultantNote&&<p style={{fontFamily:'var(--font-body)',fontSize:12,color:'var(--slate)',lineHeight:1.65,fontStyle:'italic',marginTop:10}}>{req.consultantNote}</p>}
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
                          :'$249 NZD review fee paid. This will be credited against development costs. A senior developer will review before a quote is issued.'}
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
                  {spec ? (
                    <div style={{display:'flex',flexDirection:'column',gap:10,flex:'0 0 auto'}}>
                      <div style={{background:'rgba(10,92,70,0.04)',border:'1px solid rgba(10,92,70,0.15)',borderRadius:8,padding:'12px 14px'}}>
                        <p style={{fontFamily:'var(--font-mono)',fontSize:8,letterSpacing:'0.12em',textTransform:'uppercase',color:'var(--forest)',marginBottom:5}}>Senior Developer Review — {reviewAllowance&&reviewAllowance.remaining>0?'Included with your plan':'$249 NZD'}</p>
                        <p style={{fontFamily:'var(--font-body)',fontSize:12,color:'var(--slate)',lineHeight:1.6,margin:0}}>
                          Every specification is reviewed by a senior BC developer before a quote is issued.
                          {reviewAllowance&&reviewAllowance.remaining>0
                            ? ` You have ${reviewAllowance.remaining} included review${reviewAllowance.remaining!==1?'s':''} remaining this month.`
                            : ' This fee is credited in full against development costs if you proceed.'}
                        </p>
                      </div>
                      <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
                        <button onClick={()=>submitForReview(req)} disabled={reviewLoading} style={{...pBTN,opacity:reviewLoading?0.7:1}}>
                          {reviewLoading?'Processing…':reviewAllowance&&reviewAllowance.remaining>0?'Submit for Senior Review (included) →':'Submit for Senior Review — $249 NZD →'}
                        </button>
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
                {!isSuperadmin&&req.status==='quoted'&&<>
                  <button onClick={()=>patch(req.id,{status:'deposit_required'})} disabled={actLoading} style={{...pBTN,background:'#085040'}}>✓ Accept Quote & Proceed</button>
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
                {isSuperadmin&&req.status==='deposit_required'&&(
                  <button onClick={()=>patch(req.id,{status:'deposit_paid'})} disabled={actLoading} style={{...pBTN,background:'#0F6E56'}}>✓ Confirm Deposit Received</button>
                )}
                {isSuperadmin&&req.status==='deposit_paid'&&(
                  <button onClick={()=>patch(req.id,{status:'in_development'})} disabled={actLoading} style={pBTN}>→ Start Development</button>
                )}
                {isSuperadmin&&req.status==='in_development'&&(
                  <button onClick={()=>patch(req.id,{status:'complete_pending_payment'})} disabled={actLoading} style={{...pBTN,background:'#0F6E56'}}>✓ Mark Complete — Request Balance</button>
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
              </div>

              {/* Deployed Objects — superadmin upload after fully_paid */}
              {isSuperadmin&&req.status==='fully_paid'&&(
                <div style={{...crd,borderColor:'rgba(10,92,70,0.2)',background:'rgba(10,92,70,0.02)'}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
                    <label style={{...lbl,marginBottom:0,color:'var(--forest)'}}>Deployed BC Objects</label>
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
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                    <span style={{fontSize:16}}>💳</span>
                    <span style={{fontFamily:'var(--font-mono)',fontSize:9,letterSpacing:'0.12em',textTransform:'uppercase',color:'#7A5200',fontWeight:600}}>Balance payment due</span>
                  </div>
                  <p style={{fontFamily:'var(--font-body)',fontSize:13,color:'var(--ink)',lineHeight:1.65,marginBottom:6}}>
                    Your customisation is complete. Please arrange payment of the remaining balance
                    {req.depositAmount&&req.quote ? ` ($${(parseFloat(req.quote)-parseFloat(req.depositAmount)).toLocaleString('en-NZ',{minimumFractionDigits:2})} NZD)` : ''} to receive delivery.
                  </p>
                  <p style={{fontFamily:'var(--font-body)',fontSize:12,color:'var(--slate)',lineHeight:1.5}}>Contact BespoxAI to arrange payment — delivery will follow confirmation.</p>
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
                    <div style={{...lbl,marginBottom:5}}>Amount (NZD excl. GST)</div>
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

