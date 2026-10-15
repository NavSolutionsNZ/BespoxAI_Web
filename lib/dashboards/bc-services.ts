/**
 * Standard NAV/BC pages the FlowFilter metric source reads, published by the
 * installer (step 7b, $DashboardServices) under these names. A test keeps the
 * two lists identical.
 *
 * Verification (15 Oct 2026, BC14 NZ on BC14ProdSim) — what OData exposes:
 *   - Date_Filter is Edm.String on BC14, so `Date_Filter ge <date>` is rejected.
 *     It takes a NAV filter string in ISO dates: `Date_Filter eq '2023-01-01..2023-01-31'`
 *     (dd/mm/yy strings silently return 0). dateFilterExpr builds that; the
 *     source falls back to ge/le if a BC version types the field as a date.
 *   - Bank Account List (371) exposes no balance fields at all, so cash comes
 *     from Bank Account Ledger Entries (372): Amount (LCY) summed to a date.
 *   - Customer List (22) ignores Date_Filter for Sales (LCY) (same figure for
 *     2022 and Jan 2023), so top customers sums Customer Ledger Entries by
 *     Posting Date instead (Sales_LCY and Customer_Name are on page 25).
 * `verified` is set per page once its fields and filters are confirmed live.
 * All seven verified 15 Oct 2026 on BC14 NZ (BC14ProdSim, installer 3.16):
 * every widget of the default CFO pack loaded through /admin/dashboards live.
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
    usesDateFilter: true, verified: true,
  },
  bankAccounts: {
    // Names only — page 371 has no balance fields (see above).
    serviceName: 'BespoxAI_BankAccounts', pageId: 371, pageName: 'Bank Account List',
    fields: ['No', 'Name', 'Currency_Code'],
    usesDateFilter: false, verified: true,
  },
  bankLedgerEntries: {
    serviceName: 'BespoxAI_BankLedgerEntries', pageId: 372, pageName: 'Bank Account Ledger Entries',
    fields: ['Entry_No', 'Bank_Account_No', 'Posting_Date', 'Amount_LCY'],   // no Bank_Account_Name on BC14's page 372
    usesDateFilter: false, verified: true,
  },
  custLedgerEntries: {
    serviceName: 'BespoxAI_CustLedgerEntries', pageId: 25, pageName: 'Customer Ledger Entries',
    fields: ['Entry_No', 'Customer_No', 'Customer_Name', 'Posting_Date', 'Due_Date', 'Remaining_Amt_LCY', 'Sales_LCY', 'Open'],
    usesDateFilter: false, verified: true,
  },
  vendLedgerEntries: {
    serviceName: 'BespoxAI_VendLedgerEntries', pageId: 29, pageName: 'Vendor Ledger Entries',
    fields: ['Entry_No', 'Vendor_No', 'Due_Date', 'Remaining_Amt_LCY', 'Open'],
    usesDateFilter: false, verified: true,
  },
  accountingPeriods: {
    serviceName: 'BespoxAI_AccountingPeriods', pageId: 100, pageName: 'Accounting Periods',
    fields: ['Starting_Date', 'New_Fiscal_Year'],
    usesDateFilter: false, verified: true,
  },
  customers: {
    // Names only — page 22 ignores Date_Filter for Sales (LCY) (see above), and
    // ledger Customer_Name is blank on older entries, so top customers takes
    // names from here.
    serviceName: 'BespoxAI_Customers', pageId: 22, pageName: 'Customer List',
    fields: ['No', 'Name'],
    usesDateFilter: false, verified: true,
  },
} satisfies Record<string, BcServiceDef>

export type BcServiceKey = keyof typeof BC_SERVICES

export type DateFilterStyle = 'range' | 'compare'

/**
 * OData FlowFilter for a date range. Centralised so one fix covers every metric.
 * 'range' (default): BC14 types Date_Filter as Edm.String and takes a NAV filter
 * string with ISO dates. 'compare': for a BC that types it Edm.Date — the
 * source switches to it when BC rejects the string form.
 */
export function dateFilterExpr(from: string, to: string, style: DateFilterStyle = 'range'): string {
  return style === 'range'
    ? "Date_Filter eq '" + from + '..' + to + "'"
    : 'Date_Filter ge ' + from + ' and Date_Filter le ' + to
}

/** BC's error when the filter's value type doesn't match Date_Filter's type. */
export function isDateFilterTypeError(body: string): boolean {
  return /incompatible types|Edm\.(String|Date)/i.test(body) && /Date_Filter|operator/i.test(body)
}

/**
 * Option values arrive differently across NAV versions and OData versions
 * ('Income Statement', 'Income_Statement', 'Income_x0020_Statement').
 * Compare on a normalised form instead of trusting any one encoding.
 */
export function optKey(v: unknown): string {
  return String(v ?? '').replace(/_x0020_/g, '').replace(/[^a-z0-9]/gi, '').toLowerCase()
}
