/**
 * POST /api/requirements/[id]/fetch-objects
 *
 * Superadmin only. Calls the BCAgent /bespoxai/objects/export endpoint for the
 * requirement's tenant and streams the resulting zip directly to the browser.
 *
 * For NAV/BC≤14 (finsql still exists): BCAgent runs Export-NAVApplicationObject
 * server-side and returns a zip of the C/AL .txt output. No content stored here —
 * client-side split picks objects to save via POST /api/requirements/[id]/objects
 * (JSON path). Routing is by tenant.navVersion (see isModernAL() below), not just
 * navProduct==='BC' — plenty of real BC≤14 tenants have navProduct==='BC' too.
 *
 * For confirmed BC15+ (navVersion parses to 15+): finsql.exe doesn't exist on
 * these servers at all (Microsoft dropped the Windows client/C/SIDE in BC 2019
 * release wave 2), so instead this fetches extensions + web services metadata
 * from the BC Automation API and returns a formatted text zip — NOT real object
 * source. Full AL source export is a parked TODO, see the comment on
 * isModernAL() — it may not be legitimately possible for third-party extensions
 * at all, not just unbuilt.
 *
 * Body: { objects: Array<{ type: string; id: number }> }
 *       type = "Table" | "Codeunit" | "Page" | "Report" | "XMLport" | "Query"
 *
 * maxDuration: 60s (Hobby plan). Spec-driven filters (10-30 objects) complete in
 * ~10-20s. Bump to 300 after upgrading to Vercel Pro.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { prisma }                    from '@/lib/db'

export const dynamic    = 'force-dynamic'
export const maxDuration = 300 // Vercel Pro max — finsql on remote SQL needs time

// ── DEBUG mock C/AL content ───────────────────────────────────────────────────
// Realistic sample with 3 objects, version lists, fields, and functions.
// Exercises the full pipeline without a live BCAgent.
const DEBUG_CAL = `OBJECT Codeunit 80 Sales-Post
{
  OBJECT-PROPERTIES
  {
    Date=20241015;
    Time=120000T;
    Modified=Yes;
    Version List=NAVW17.10.00.45254,N.7.2.1;
  }
  PROPERTIES
  {
    OnRun=BEGIN
            PostDocument;
          END;
  }
  CODE
  {
    VAR
      SalesHeader@1000 : Record 36;
      SalesLine@1001 : Record 37;
      CustLedgEntry@1002 : Record 21;

    PROCEDURE PostDocument@1();
    BEGIN
      SalesHeader.TESTFIELD(Status,SalesHeader.Status::Released);
      CheckCustomerBlocked(SalesHeader);
      PostLines(SalesHeader);
      PostHeader(SalesHeader);
    END;

    LOCAL PROCEDURE CheckCustomerBlocked@2(VAR SalesHeader@1000 : Record 36);
    VAR
      Cust@1001 : Record 18;
    BEGIN
      Cust.GET(SalesHeader."Sell-to Customer No.");
      IF Cust.Blocked <> Cust.Blocked::" " THEN
        ERROR(Text001,Cust."No.",Cust.Blocked);
      // N.7.2.1: Custom credit check added
      IF Cust."Custom Credit Hold" THEN
        ERROR(Text002,Cust."No.");
    END;

    LOCAL PROCEDURE PostLines@3(VAR SalesHeader@1000 : Record 36);
    BEGIN
      SalesLine.SETRANGE("Document Type",SalesHeader."Document Type");
      SalesLine.SETRANGE("Document No.",SalesHeader."No.");
      IF SalesLine.FINDSET THEN
        REPEAT
          PostLine(SalesLine);
        UNTIL SalesLine.NEXT = 0;
    END;

    LOCAL PROCEDURE PostHeader@4(VAR SalesHeader@1000 : Record 36);
    BEGIN
      SalesHeader.Status := SalesHeader.Status::Open;
      SalesHeader.MODIFY;
    END;

    BEGIN
    Text001@1000 : TextConst 'ENU=Customer %1 is blocked (%2).';
    Text002@1001 : TextConst 'ENU=Customer %1 is on credit hold (custom).';
    END.
  }
}

OBJECT Table 50100 Custom Approval Entry
{
  OBJECT-PROPERTIES
  {
    Date=20241001;
    Time=090000T;
    Modified=Yes;
    Version List=N.7.2.1;
  }
  PROPERTIES
  {
    DataClassification=CustomerContent;
  }
  FIELDS
  {
    { 1   ;   ;Entry No.;Integer;AutoIncrement=Yes }
    { 2   ;   ;Document Type;Option;OptionString=Quote,Order,Invoice,Credit Memo }
    { 3   ;   ;Document No.;Code20 }
    { 4   ;   ;Approver ID;Code50;TableRelation=User."User Name" }
    { 5   ;   ;Status;Option;OptionString=Open,Approved,Rejected,Delegated }
    { 6   ;   ;Amount;Decimal }
    { 7   ;   ;Due Date;Date }
    { 8   ;   ;Delegated To;Code50;TableRelation=User."User Name" }
    { 9   ;   ;Comments;Text250 }
    { 10  ;   ;Created At;DateTime }
    { 11  ;   ;Approved At;DateTime }
  }
  KEYS
  {
    {    ;Entry No.;Clustered=Yes }
    {    ;Document Type,Document No. }
    {    ;Approver ID,Status }
  }
}

OBJECT Page 50300 Custom Approval List
{
  OBJECT-PROPERTIES
  {
    Date=20240901;
    Time=110000T;
    Modified=Yes;
    Version List=N.7.2.1;
  }
  PROPERTIES
  {
    SourceTable=Table50100;
    SourceTableView=SORTING(Entry No.) ORDER(Descending);
    PageType=List;
    CardPageID=Page50301;
    UsageCategory=Lists;
    OnOpenPage=BEGIN
                 SETRANGE("Approver ID",USERID);
               END;
  }
  CONTROLS
  {
    { 1   ;0  ;Container;ContainerType=ContentArea }
    { 2   ;1  ;Group    ;GroupType=Repeater }
    { 3   ;2  ;Field    ;SourceExpr="Document Type" }
    { 4   ;2  ;Field    ;SourceExpr="Document No." }
    { 5   ;2  ;Field    ;SourceExpr=Amount }
    { 6   ;2  ;Field    ;SourceExpr=Status }
    { 7   ;2  ;Field    ;SourceExpr="Due Date" }
    { 8   ;2  ;Field    ;SourceExpr="Created At" }
  }
  ACTIONCONTROLS
  {
    { 9   ;0  ;ActionContainer;ActionContainerType=ActionItems }
    { 10  ;1  ;Action   ;Name=Approve;ShortCutKey=Ctrl+F9;OnAction=BEGIN SetStatus(Status::Approved); END }
    { 11  ;1  ;Action   ;Name=Reject;OnAction=BEGIN SetStatus(Status::Rejected); END }
    { 12  ;1  ;Action   ;Name=Delegate;OnAction=BEGIN DelegatePage.RUN; END }
  }
}
`

// BespoxAI's object-export pipeline (finsql/C/AL) only works on classic NAV and
// Business Central up to BC14 — the last release to ship the Windows client /
// C/SIDE (finsql.exe). BC15+ dropped it entirely in favour of AL extensions,
// which BCAgent cannot export as readable source today (see TODO below) — this
// helper detects that case so we route to the metadata-only fallback instead of
// hard-failing on "finsql.exe not found", which is confusing on a BC15+ server
// where finsql was never going to exist in the first place.
//
// TODO(AL source export — parked, not yet solvable): Modern AL extensions gate
// source download behind `resourceExposurePolicy.allowDownloadingSource` in the
// extension's OWN app.json, set by its original developer at build/publish time
// — default is false, and there's no clean on-prem admin bypass we've confirmed
// (the SaaS Key Vault override documented by Microsoft doesn't apply to on-prem
// servers like this one; the older on-prem `Get-NavAppRuntimePackage -ShowMyCode`
// cmdlet is unverified against a policy-off app — needs a real test extension,
// which we don't have yet). Net effect: for third-party BC15+ extensions we
// didn't build ourselves, there may be NO legitimate way to pull readable AL
// source, ever — this could be a genuine product limitation, not a missing
// feature. For extensions BespoxAI builds/migrates itself going forward this is
// moot (source lives in our own git repo from day one). Until this is resolved,
// BC15+ tenants only ever get the metadata-only export below (extensions +
// published web services) — no object source. Customer-facing wording needs to
// reflect this: full BespoxAI feasibility/dev-plan/coding-assistant support is
// scoped to NAV and Business Central up to BC14 (C/AL, OData-capable); BC15+/AL
// is best-effort/metadata-only until this is revisited.
function isModernAL(navVersion: string | null): boolean {
  if (!navVersion) return false
  const m = navVersion.match(/\bBC\s*-?\s*(\d{2,3})\b/i) ?? navVersion.match(/\((?:BC)?\s*(\d{2,3})\)/i)
  if (!m) return false
  const majorVersion = parseInt(m[1], 10)
  return Number.isFinite(majorVersion) && majorVersion >= 15
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user || (session.user as any).role !== 'superadmin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // ── DEBUG — return sample zip without calling BCAgent ─────────────────────
  if (process.env.SETTINGS_DEBUG === 'true') {
    const { default: JSZip } = await import('jszip')
    const zip = new JSZip()
    zip.file('nav-objects-DEBUG.txt', DEBUG_CAL)
    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    return new NextResponse(buf as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type':        'application/zip',
        'Content-Disposition': 'attachment; filename="nav-objects-DEBUG.zip"',
        'X-Debug-Mode':        'true',
        'X-Object-Count':      '3',
      },
    })
  }
  // ── END DEBUG ─────────────────────────────────────────────────────────────

  // ── Load requirement → derive tenant (never use session tenant) ────────────
  const requirement = await (prisma as any).requirement.findUnique({
    where:  { id: params.id },
    select: { tenantId: true },
  })
  if (!requirement)
    return NextResponse.json({ error: 'Requirement not found' }, { status: 404 })

  const tenant = await (prisma as any).tenant.findUnique({
    where:  { id: requirement.tenantId },
    select: {
      id: true, name: true, tunnelSubdomain: true, apiKey: true,
      navProduct: true, navDatabaseName: true, navVersion: true,
    },
  })
  if (!tenant)
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  if (!tenant.tunnelSubdomain)
    return NextResponse.json({ error: 'No tunnel configured for this tenant' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const { objects } = body as { objects?: Array<{ type: string; id: number }> }

  const agentBase = `https://${tenant.tunnelSubdomain}-agent.bespoxai.com`

  // ── NAV / BC≤14 path ───────────────────────────────────────────────────────
  // NAV, BC≤14, and unset/unparseable navVersion all use C/AL (finsql) — only a
  // confirmed BC15+ navVersion routes to the AL metadata-only fallback below.
  // Previously this branch caught EVERY navProduct==='BC' tenant regardless of
  // version, making the AL path below unreachable — that's what made BC22 fail
  // with a confusing "finsql.exe not found" instead of a clear "AL, metadata
  // only" response. See the isModernAL() TODO above for why the AL path is
  // metadata-only rather than a real object export.
  if (tenant.navProduct === 'NAV' || tenant.navProduct === null || !isModernAL(tenant.navVersion)) {
    if (!objects || objects.length === 0)
      return NextResponse.json({ error: 'No objects specified' }, { status: 400 })

    if (!tenant.navDatabaseName)
      return NextResponse.json({
        error: 'NAV database name not configured. Add it in the BC Installer tab and regenerate the installer.',
      }, { status: 400 })

    if (objects.length > 50)
      return NextResponse.json({
        error: `Too many objects (${objects.length}). Select 50 or fewer per fetch to stay within the 60s timeout.`,
      }, { status: 400 })

    const agentRes = await fetch(`${agentBase}/bespoxai/objects/export`, {
      method:  'POST',
      headers: {
        'Content-Type':    'application/json',
        'X-BespoxAI-Key':  tenant.apiKey,
      },
      body:   JSON.stringify({ requirementId: params.id, objects }),
      signal: AbortSignal.timeout(120_000), // 120s — finsql on remote SQL can be slow
    })

    if (!agentRes.ok) {
      let msg = `BCAgent returned ${agentRes.status}`
      try {
        const err = await agentRes.json()
        msg = err.error ?? msg
      } catch {}
      return NextResponse.json({ error: msg }, { status: 502 })
    }

    // Stream zip straight to browser
    return new NextResponse(agentRes.body, {
      status: 200,
      headers: {
        'Content-Type':        'application/zip',
        'Content-Disposition': 'attachment; filename="nav-objects.zip"',
        'X-Tenant-Name':       tenant.name,
        'X-Object-Count':      String(objects.length),
      },
    })
  }

  // ── BC15+ path — metadata only, NOT object source (see isModernAL() TODO) ──
  const results: string[] = [
    `BespoxAI — BC Metadata Export (BC15+, AL)`,
    `Tenant: ${tenant.name}`,
    `Detected version: ${tenant.navVersion ?? '(not set)'}`,
    `Exported: ${new Date().toISOString()}`,
    ``,
    `NOTE: This tenant is on Business Central 15+ (AL extensions), where BespoxAI`,
    `cannot currently export readable object source the way it does for NAV/BC≤14`,
    `(C/AL). Full source download for an already-published extension is gated by`,
    `that extension's own "allowDownloadingSource" policy, set by its original`,
    `developer — not something BespoxAI can turn on after the fact. What follows`,
    `is metadata only: installed extensions and published web services, not`,
    `object code. Feasibility checks, dev-plan generation, and the coding`,
    `assistant will be working from this metadata alone for this tenant.`,
    ``,
    `${'='.repeat(60)}`,
    `INSTALLED EXTENSIONS`,
    `${'='.repeat(60)}`,
  ]

  try {
    const extUrl = `${agentBase}/api/v2.0/extensions?$top=100`
    const extRes = await fetch(extUrl, { headers: { 'X-BespoxAI-Key': tenant.apiKey, Accept: 'application/json' } })
    if (extRes.ok) {
      const extData = await extRes.json()
      const exts = extData.value ?? []
      for (const e of exts) {
        results.push(`${e.displayName ?? e.name} | Publisher: ${e.publisher} | Version: ${e.versionMajor}.${e.versionMinor}.${e.versionBuild} | ID: ${e.packageId}`)
      }
      results.push(``, `Total extensions: ${exts.length}`)
    }
  } catch {
    results.push('(Could not fetch extensions — check BC connection)')
  }

  results.push(``, `${'='.repeat(60)}`, `PUBLISHED WEB SERVICES`, `${'='.repeat(60)}`)

  try {
    const wsUrl = `${agentBase}/api/v2.0/webServices?$top=200`
    const wsRes = await fetch(wsUrl, { headers: { 'X-BespoxAI-Key': tenant.apiKey, Accept: 'application/json' } })
    if (wsRes.ok) {
      const wsData = await wsRes.json()
      const svcs = wsData.value ?? []
      for (const w of svcs) {
        results.push(`${w.objectType} ${w.objectId} "${w.objectName}" → Service: ${w.serviceName}`)
      }
      results.push(``, `Total web services: ${svcs.length}`)
    }
  } catch {
    results.push('(Could not fetch web services)')
  }

  const txt = results.join('\n')

  // Return as a zip for consistent handling in the client
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  zip.file('bc-metadata.txt', txt)
  const zipBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })

  return new NextResponse(zipBuf as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type':        'application/zip',
      'Content-Disposition': 'attachment; filename="bc-metadata.zip"',
      'X-Tenant-Name':       tenant.name,
    },
  })
}
