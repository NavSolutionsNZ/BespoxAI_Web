/**
 * BC 14 OData entity catalogue for the CFO Assistant.
 *
 * The keys below are LOGICAL entity names: the planner prompt uses them and the
 * AI answers with them. The OData entity actually queried is resolved per
 * tenant from its $metadata (resolveEntities): the BespoxAI_ web service the
 * installer publishes (agent 3.13+) is preferred, the standard name is the
 * fallback, so older installs that published the standard names keep working.
 *
 * Fields are hints: buildCatalogue() narrows them to the properties the
 * tenant's $metadata actually exposes, so a field that only exists on one
 * customer's pages is never offered to the planner elsewhere.
 */

export const BC_ENTITIES = {
  // --- Customers & Sales ---
  Customer: {
    description: 'Customers / debtors / clients. To find overdue/outstanding debtors use $filter=Balance_LCY gt 0 — there is NO Due_Date, no Overdue field. Balance_LCY is the outstanding amount.',
    keyField: 'No',
    usefulFields: [
      'No', 'Name', 'Balance_LCY', 'Sales_LCY', 'Credit_Limit_LCY',
      'Phone_No', 'Mobile_Phone_No', 'E_Mail',
      'Address', 'City', 'Post_Code', 'Country_Region_Code',
      'Payment_Terms_Code', 'Payment_Method_Code', 'Salesperson_Code',
      'Blocked', 'Creation_Date', 'Last_Date_Modified', 'VAT_Registration_No',
    ],
  },
  SalesOrder: {
    description: 'Open (unposted) sales orders — header only, no Amount fields. Use SalesOrderSalesLines for amounts. Status_Code not Status.',
    keyField: 'No',
    usefulFields: [
      'No', 'Sell_to_Customer_No', 'Sell_to_Customer_Name',
      'Order_Date', 'Posting_Date', 'Due_Date', 'Shipment_Date',
      'Status_Code', 'Salesperson_Code', 'Payment_Terms_Code',
      'Location_Code', 'Shortcut_Dimension_1_Code', 'Shortcut_Dimension_2_Code',
    ],
  },
  SalesOrderSalesLines: {
    description: 'Sales order lines — individual line items on sales orders',
    keyField: 'Document_No',
    usefulFields: [
      'Document_No', 'Line_No', 'Type', 'No', 'Description',
      'Quantity', 'Unit_Price', 'Line_Amount',
    ],
  },
  SalesInvoice: {
    description: 'Posted sales invoice headers — dates, customer, payment terms only. Has NO amount fields. Use SalesInvoiceSalesLines for amounts.',
    keyField: 'No',
    usefulFields: [
      'No', 'Sell_to_Customer_No', 'Sell_to_Customer_Name',
      'Posting_Date', 'Document_Date', 'Due_Date',
      'Payment_Terms_Code', 'Payment_Method_Code', 'Salesperson_Code', 'Currency_Code',
    ],
  },
  SalesInvoiceSalesLines: {
    description: 'Posted sales invoice lines — has Amount_Including_VAT and Line_Amount but NO Posting_Date. Join Document_No to SalesInvoice.No to get dates.',
    keyField: 'Document_No',
    usefulFields: [
      'Document_No', 'Line_No', 'Type', 'No', 'Description',
      'Quantity', 'Unit_Price', 'Line_Amount', 'Amount', 'Amount_Including_VAT',
    ],
  },
  SalesCrMemo: {
    description: 'Posted sales credit memo headers — dates and customer only. No amount fields. Use SalesCrMemoSalesLines for amounts.',
    keyField: 'No',
    usefulFields: [
      'No', 'Sell_to_Customer_No', 'Sell_to_Customer_Name',
      'Posting_Date', 'Document_Date', 'Payment_Terms_Code', 'Currency_Code',
    ],
  },
  SalesCrMemoSalesLines: {
    description: 'Sales credit memo lines — has Line_Amount but NO Posting_Date. Join Document_No to SalesCrMemo.No to get dates.',
    keyField: 'Document_No',
    usefulFields: [
      'Document_No', 'Line_No', 'No', 'Description',
      'Quantity', 'Unit_Price', 'Line_Amount', 'Amount_Including_VAT',
    ],
  },

  // --- Vendors & Purchasing ---
  Vendor: {
    description: 'Vendors / suppliers / creditors. To find vendors with outstanding AP use $filter=Balance_LCY gt 0. No Due_Date field on Vendor.',
    keyField: 'No',
    usefulFields: [
      'No', 'Name', 'Balance_LCY', 'Purchases_LCY',
      'Phone_No', 'Mobile_Phone_No', 'E_Mail',
      'Address', 'City', 'Post_Code', 'Country_Region_Code',
      'Payment_Terms_Code', 'Payment_Method_Code', 'Purchaser_Code',
      'Blocked', 'Last_Date_Modified', 'VAT_Registration_No', 'No_of_Documents',
    ],
  },
  PurchaseOrder: {
    description: 'Open (unposted) purchase orders — header only, no Amount fields. Use PurchaseOrderPurchLines for amounts. Status_Code not Status.',
    keyField: 'No',
    usefulFields: [
      'No', 'Buy_from_Vendor_No', 'Buy_from_Vendor_Name',
      'Order_Date', 'Posting_Date', 'Due_Date', 'Expected_Receipt_Date',
      'Status_Code', 'Purch_Order_Type', 'Purchaser_Code', 'Payment_Terms_Code',
      'Location_Code', 'Shortcut_Dimension_1_Code',
    ],
  },
  PurchaseOrderPurchLines: {
    description: 'Purchase order lines — individual line items on purchase orders',
    keyField: 'Document_No',
    usefulFields: [
      'Document_No', 'Line_No', 'Type', 'No', 'Description',
      'Quantity', 'Direct_Unit_Cost', 'Line_Amount',
    ],
  },
  PurchaseInvoice: {
    description: 'Posted purchase invoice headers — dates and vendor only. No amount fields. Use PurchaseInvoicePurchLines for amounts.',
    keyField: 'No',
    usefulFields: [
      'No', 'Buy_from_Vendor_No', 'Buy_from_Vendor_Name',
      'Posting_Date', 'Document_Date', 'Due_Date',
      'Payment_Terms_Code', 'Currency_Code',
    ],
  },
  PurchaseInvoicePurchLines: {
    description: 'Posted purchase invoice lines — has Line_Amount but NO Posting_Date. Join Document_No to PurchaseInvoice.No to get dates.',
    keyField: 'Document_No',
    usefulFields: [
      'Document_No', 'Line_No', 'No', 'Description',
      'Quantity', 'Direct_Unit_Cost', 'Line_Amount', 'Amount', 'Amount_Including_VAT',
    ],
  },

  // --- Inventory ---
  Item: {
    description: 'Inventory items / products / stock / parts / vehicles. Blocked is boolean (false=active). No Item_Category_Code field.',
    keyField: 'No',
    usefulFields: [
      'No', 'Description', 'Make_Code', 'Item_Group_Code',
      'Unit_Price', 'Unit_Price_incl_VAT', 'Unit_Cost', 'Last_Direct_Cost',
      'Inventory', 'Vendor_No', 'Base_Unit_of_Measure',
      'Blocked', 'Creation_Date', 'Last_Date_Modified',
      'Inventory_Posting_Group', 'Gen_Prod_Posting_Group',
    ],
  },

  // --- Finance ---
  GeneralLedgerEntry: {
    description: 'Financial general ledger entries — debits, credits, account postings. Use for P&L, budget vs actual, cost centre analysis, VAT. Has G_L_Account_No, G_L_Account_Name, Debit_Amount, Credit_Amount. Posting_Date is a bare date — do not use $filter on it.',
    keyField: 'Entry_No',
    usefulFields: [
      'Entry_No', 'Transaction_No', 'Posting_Date', 'Register_Date',
      'Document_Type', 'Document_No', 'External_Document_No',
      'G_L_Account_No', 'G_L_Account_Name', 'Description',
      'Amount', 'Debit_Amount', 'Credit_Amount', 'VAT_Amount',
      'Source_Type', 'Source_No',
      'Global_Dimension_1_Code', 'Global_Dimension_2_Code', 'Branch_Code',
      'Gen_Posting_Type', 'Gen_Bus_Posting_Group', 'Gen_Prod_Posting_Group',
      'Reversed', 'Source_Code', 'Reason_Code',
    ],
  },

  // --- Item Ledger ---
  ItemLedgerEntry: {
    description: 'Item ledger entries — physical inventory movements (vehicle/parts purchases and sales). Entry_Type is Purchase or Sale. Amount is cost value. Use for stock movement, vehicle sales history, inventory cost by item.',
    keyField: 'Entry_No',
    usefulFields: [
      'Entry_No', 'Posting_Date', 'Entry_Type', 'Document_No',
      'Item_No', 'Description', 'Amount', 'Adjusted_Cost',
      'Quantity', 'Invoiced_Quantity', 'Remaining_Quantity',
      'Location_Code', 'Global_Dimension_1_Code', 'Global_Dimension_2_Code',
      'Serial_No', 'VIN', 'Open',
      'Salespers_Purch_Code', 'Source_No_Payment', 'Main_Area',
    ],
  },

  // --- Service ---
  ServiceInvoiceLines: {
    description: 'Service invoice lines — service department billing lines',
    keyField: 'Document_No',
    usefulFields: [
      'Document_No', 'Line_No', 'Type', 'No', 'Description',
      'Quantity', 'Unit_Price', 'Line_Amount', 'Posting_Date',
    ],
  },
} as const

export type BCEntityName = keyof typeof BC_ENTITIES

/** Returns a formatted string for Claude's system prompt, optionally filtered by enabled entities */
export function getEntitiesSummary(enabledEntities?: Record<string, boolean>): string {
  return Object.entries(BC_ENTITIES)
    .filter(([name]) => !enabledEntities || enabledEntities[name] !== false)
    .map(([name, info]) =>
      `  - ${name}: ${info.description}\n    Fields: ${info.usefulFields.join(', ')}`)
    .join('\n')
}

/** Returns selected fields for a given entity (for $select hint) */
export function getEntityFields(entity: BCEntityName): string[] {
  return [...BC_ENTITIES[entity].usefulFields] as string[]
}

// ─── Web services the installer publishes for the CFO Assistant ─────────────
// MUST match $CfoServices in scripts/Install-BespoxAI.ps1 (tests check this).
// Line entities (e.g. SalesOrderSalesLines) come with their header page: OData
// names them <service name><subpage control name>.

export interface CfoServiceDef { logical: BCEntityName; serviceName: string; pageId: number; pageName: string }

export const CFO_SERVICES: CfoServiceDef[] = [
  { logical: 'Customer',           serviceName: 'BespoxAI_Customer',           pageId: 21,  pageName: 'Customer Card' },
  { logical: 'Vendor',             serviceName: 'BespoxAI_Vendor',             pageId: 26,  pageName: 'Vendor Card' },
  { logical: 'Item',               serviceName: 'BespoxAI_Item',               pageId: 30,  pageName: 'Item Card' },
  { logical: 'SalesOrder',         serviceName: 'BespoxAI_SalesOrder',         pageId: 42,  pageName: 'Sales Order' },
  { logical: 'PurchaseOrder',      serviceName: 'BespoxAI_PurchaseOrder',      pageId: 50,  pageName: 'Purchase Order' },
  { logical: 'SalesInvoice',       serviceName: 'BespoxAI_SalesInvoice',       pageId: 132, pageName: 'Posted Sales Invoice' },
  { logical: 'SalesCrMemo',        serviceName: 'BespoxAI_SalesCrMemo',        pageId: 134, pageName: 'Posted Sales Credit Memo' },
  { logical: 'PurchaseInvoice',    serviceName: 'BespoxAI_PurchaseInvoice',    pageId: 138, pageName: 'Posted Purchase Invoice' },
  { logical: 'GeneralLedgerEntry', serviceName: 'BespoxAI_GeneralLedgerEntry', pageId: 20,  pageName: 'General Ledger Entries' },
  { logical: 'ItemLedgerEntry',    serviceName: 'BespoxAI_ItemLedgerEntry',    pageId: 38,  pageName: 'Item Ledger Entries' },
]

/** Line entities and the header they belong to. */
export const LINE_PARENTS: Partial<Record<BCEntityName, BCEntityName>> = {
  SalesOrderSalesLines:      'SalesOrder',
  SalesInvoiceSalesLines:    'SalesInvoice',
  SalesCrMemoSalesLines:     'SalesCrMemo',
  PurchaseOrderPurchLines:   'PurchaseOrder',
  PurchaseInvoicePurchLines: 'PurchaseInvoice',
}

// ─── $metadata ───────────────────────────────────────────────────────────────

export interface ODataMetadata {
  entitySets: string[]
  /** Property names per entity set (empty array when the type wasn't found). */
  fields: Record<string, string[]>
}

/** Parses BC's OData v4 $metadata (CSDL XML): entity sets and their properties. */
export function parseMetadata(xml: string): ODataMetadata {
  const typeProps: Record<string, string[]> = {}
  const typeRe = /<EntityType\b[^>]*\bName="([^"]+)"[^>]*>([\s\S]*?)<\/EntityType>/g
  let t: RegExpExecArray | null
  while ((t = typeRe.exec(xml)) !== null) {
    const props: string[] = []
    const propRe = /<Property\b[^>]*\bName="([^"]+)"/g
    let p: RegExpExecArray | null
    while ((p = propRe.exec(t[2])) !== null) props.push(p[1])
    typeProps[t[1]] = props
  }
  const entitySets: string[] = []
  const fields: Record<string, string[]> = {}
  const setRe = /<EntitySet\b([^>]*)>/g
  let m: RegExpExecArray | null
  while ((m = setRe.exec(xml)) !== null) {
    const name = /\bName="([^"]+)"/.exec(m[1])?.[1]
    if (!name || fields[name]) continue
    const type = (/\bEntityType="([^"]+)"/.exec(m[1])?.[1] ?? '').split('.').pop() ?? ''
    entitySets.push(name)
    fields[name] = typeProps[type] ?? []
  }
  return { entitySets, fields }
}

// ─── Resolution ──────────────────────────────────────────────────────────────

/**
 * Maps each logical entity to the OData entity set this tenant actually has.
 * Headers: the BespoxAI_ service if published, else the standard name.
 * Lines: <resolved header><suffix> if present, else the one other entity set
 * whose name starts with the resolved header (the subpage control name varies
 * by page, e.g. Posted Sales Invoice's lines are not called "SalesLines").
 */
export function resolveEntities(available: string[]): Partial<Record<BCEntityName, string>> {
  const have = new Set(available)
  const out: Partial<Record<BCEntityName, string>> = {}
  const logicals = Object.keys(BC_ENTITIES) as BCEntityName[]

  for (const logical of logicals) {
    if (LINE_PARENTS[logical]) continue
    const svc = CFO_SERVICES.find(s => s.logical === logical)
    if (svc && have.has(svc.serviceName)) out[logical] = svc.serviceName
    else if (have.has(logical)) out[logical] = logical
  }

  const taken = new Set(Object.values(out))
  for (const logical of logicals) {
    const parent = LINE_PARENTS[logical]
    if (!parent) continue
    const header = out[parent]
    if (!header) continue
    const suffix = logical.slice(parent.length)          // e.g. 'SalesLines'
    if (have.has(header + suffix)) { out[logical] = header + suffix; taken.add(header + suffix); continue }
    const candidates = available.filter(n => n !== header && n.startsWith(header) && !taken.has(n))
    if (candidates.length === 1) { out[logical] = candidates[0]; taken.add(candidates[0]) }
  }
  return out
}

export interface CatalogueEntry {
  logical: BCEntityName
  /** OData entity set to query. */
  entitySet: string
  description: string
  fields: string[]
}

/**
 * The entities the planner may use for this tenant, with the fields that exist.
 * Without metadata (agent unreachable) it falls back to the static catalogue
 * under the standard names, which is how the CFO Assistant behaved before.
 * Entities an admin switched off (entityConfig[name] === false, by OData or
 * logical name) are left out.
 */
export function buildCatalogue(meta: ODataMetadata | null, entityConfig?: Record<string, boolean> | null): CatalogueEntry[] {
  const disabled = (n: string) => !!entityConfig && entityConfig[n] === false
  const logicals = Object.keys(BC_ENTITIES) as BCEntityName[]

  if (!meta) {
    return logicals
      .filter(l => !disabled(l))
      .map(l => ({ logical: l, entitySet: l, description: BC_ENTITIES[l].description, fields: [...BC_ENTITIES[l].usefulFields] }))
  }

  const resolved = resolveEntities(meta.entitySets)
  const out: CatalogueEntry[] = []
  for (const logical of logicals) {
    const entitySet = resolved[logical]
    if (!entitySet || disabled(entitySet) || disabled(logical)) continue
    const actual = meta.fields[entitySet] ?? []
    const hints = BC_ENTITIES[logical].usefulFields as readonly string[]
    let fields = actual.length ? hints.filter(f => actual.includes(f)) : [...hints]
    // Hints that don't match this page at all: offer the page's own fields instead.
    if (actual.length && fields.length < 2) fields = actual.slice(0, 30)
    out.push({ logical, entitySet, description: BC_ENTITIES[logical].description, fields })
  }
  return out
}

/** The "Available entities" block of the planner prompt. */
export function catalogueSummary(entries: CatalogueEntry[]): string {
  return entries
    .map(e => `  - ${e.logical}: ${e.description}\n    Fields: ${e.fields.join(', ')}`)
    .join('\n')
}
