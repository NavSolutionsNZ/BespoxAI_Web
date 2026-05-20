/**
 * lib/business-config.ts
 *
 * Business/invoice configuration — read from the BusinessConfig DB table,
 * editable by superadmin via the admin Business Settings tab.
 * Cached for 60 seconds. Used by invoice PDF generation and payment routes.
 */
import { prisma } from '@/lib/db'

export interface BusinessConfigValues {
  companyName:     string
  gstNumber:       string | null
  email:           string
  phone:           string | null
  website:         string
  address:         string | null
  bankName:        string | null
  bankAccount:     string | null
  bankAccountName: string | null
  invoiceFooter:   string
  terms1Label:     string
  terms1Text:      string
  terms2Label:     string
  terms2Text:      string
  terms3Label:     string
  terms3Text:      string
  updatedAt?:      Date | null
  updatedBy?:      string | null
}

const DEFAULTS: BusinessConfigValues = {
  companyName:     'Nav Solutions NZ',
  gstNumber:       null,
  email:           'auckland@bespoxai.com',
  phone:           null,
  website:         'bespoxai.com',
  address:         null,
  bankName:        null,
  bankAccount:     null,
  bankAccountName: null,
  invoiceFooter:   'Thank you for choosing BespoxAI',
  terms1Label:     'Standard',
  terms1Text:      '20% deposit on acceptance; 80% on delivery',
  terms2Label:     'Deposit + Monthly',
  terms2Text:      '20% deposit on acceptance; balance due 20th of following month',
  terms3Label:     'Account',
  terms3Text:      'Full amount due 20th of the following month',
}

// ── 60-second cache ───────────────────────────────────────────────────────────
let _cache:   BusinessConfigValues | null = null
let _cacheAt: number = 0
const CACHE_TTL_MS = 60_000

export async function getBusinessConfig(): Promise<BusinessConfigValues> {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL_MS) return _cache
  try {
    const row = await (prisma as any).businessConfig.findUnique({ where: { id: 'default' } })
    const cfg: BusinessConfigValues = row ? {
      companyName:     row.companyName,
      gstNumber:       row.gstNumber,
      email:           row.email,
      phone:           row.phone,
      website:         row.website,
      address:         row.address,
      bankName:        row.bankName,
      bankAccount:     row.bankAccount,
      bankAccountName: row.bankAccountName,
      invoiceFooter:   row.invoiceFooter,
      terms1Label:     row.terms1Label,
      terms1Text:      row.terms1Text,
      terms2Label:     row.terms2Label,
      terms2Text:      row.terms2Text,
      terms3Label:     row.terms3Label,
      terms3Text:      row.terms3Text,
      updatedAt:       row.updatedAt,
      updatedBy:       row.updatedBy,
    } : { ...DEFAULTS }
    _cache   = cfg
    _cacheAt = Date.now()
    return cfg
  } catch {
    return { ...DEFAULTS }
  }
}

export function invalidateBusinessConfigCache() {
  _cache   = null
  _cacheAt = 0
}

/** Get the terms label + text for a given key */
export function getTerms(cfg: BusinessConfigValues, key: string | null | undefined) {
  if (key === 'terms2') return { label: cfg.terms2Label, text: cfg.terms2Text }
  if (key === 'terms3') return { label: cfg.terms3Label, text: cfg.terms3Text }
  return { label: cfg.terms1Label, text: cfg.terms1Text }
}

/** Whether this terms key requires an upfront deposit */
export function requiresDeposit(termsKey: string | null | undefined): boolean {
  return termsKey !== 'terms3'
}

/** Whether this terms key uses monthly billing for the balance */
export function isMonthlyBilling(termsKey: string | null | undefined): boolean {
  return termsKey === 'terms2' || termsKey === 'terms3'
}

/** Calculate the 20th of the month following the given date */
export function getMonthlyDueDate(from: Date = new Date()): Date {
  return new Date(from.getFullYear(), from.getMonth() + 1, 20)
}

export function formatDueDate(from: Date = new Date()): string {
  return getMonthlyDueDate(from).toLocaleDateString('en-NZ', { dateStyle: 'long' })
}

/** NZ GST rate */
export const GST_RATE = 0.15
