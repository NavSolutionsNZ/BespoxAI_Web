/**
 * Standard NAV/BC pages the FlowFilter metric source reads.
 *
 * The installer will publish these as page web services under these names
 * (a later slice — kept here so the installer and the source share one list).
 *
 * VERIFY before customer-facing use: the field names and the Date_Filter
 * behaviour below are not yet confirmed against a live NAV. Each entry carries
 * `verified: false` until it has been. The things to check per page:
 *   - every field in `fields` is exposed on the page (OData only exposes page controls)
 *   - `$filter=Date_Filter ...` is accepted and drives the FlowFields
 *     (if Date Filter is not a page control, OData may reject it)
 *
 * When Query objects arrive, they replace these pages behind the same metric
 * IDs (sources/query-object.ts) — nothing above the source layer changes.
 */
export interface BcServiceDef {
  serviceName: string
  pageId: number
  pageName: string
  fields: string[]
  usesDateFilter: boolean
  verified: boolean
}

export const BC_SERVICES = {
  glAccounts: {
    serviceName: 'BespoxAI_GLAccounts', pageId: 16, pageName: 'Chart of Accounts',
    fields: ['No', 'Name', 'Income_Balance', 'Account_Type', 'Account_Category', 'Net_Change'],
    usesDateFilter: true, verified: false,
  },
  bankAccounts: {
    serviceName: 'BespoxAI_BankAccounts', pageId: 371, pageName: 'Bank Account List',
    fields: ['No', 'Name', 'Currency_Code', 'Balance_at_Date_LCY'],
    usesDateFilter: true, verified: false,
  },
  custLedgerEntries: {
    serviceName: 'BespoxAI_CustLedgerEntries', pageId: 25, pageName: 'Customer Ledger Entries',
    fields: ['Entry_No', 'Customer_No', 'Due_Date', 'Remaining_Amt_LCY', 'Open'],
    usesDateFilter: false, verified: false,
  },
  vendLedgerEntries: {
    serviceName: 'BespoxAI_VendLedgerEntries', pageId: 29, pageName: 'Vendor Ledger Entries',
    fields: ['Entry_No', 'Vendor_No', 'Due_Date', 'Remaining_Amt_LCY', 'Open'],
    usesDateFilter: false, verified: false,
  },
  accountingPeriods: {
    serviceName: 'BespoxAI_AccountingPeriods', pageId: 100, pageName: 'Accounting Periods',
    fields: ['Starting_Date', 'New_Fiscal_Year'],
    usesDateFilter: false, verified: false,
  },
  customers: {
    serviceName: 'BespoxAI_Customers', pageId: 22, pageName: 'Customer List',
    fields: ['No', 'Name', 'Sales_LCY'],
    usesDateFilter: true, verified: false,
  },
} satisfies Record<string, BcServiceDef>

export type BcServiceKey = keyof typeof BC_SERVICES

/** OData V4 FlowFilter range. Centralised so one fix covers every metric. */
export function dateFilterExpr(from: string, to: string): string {
  return 'Date_Filter ge ' + from + ' and Date_Filter le ' + to
}

/**
 * Option values arrive differently across NAV versions and OData versions
 * ('Income Statement', 'Income_Statement', 'Income_x0020_Statement').
 * Compare on a normalised form instead of trusting any one encoding.
 */
export function optKey(v: unknown): string {
  return String(v ?? '').replace(/_x0020_/g, '').replace(/[^a-z0-9]/gi, '').toLowerCase()
}
