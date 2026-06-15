export interface BrandingConfig {
  brandName:      string        // default: 'BespoxAI'
  logoUrl:        string | null // default: null (use built-in SVG logo)
  isWhiteLabel:   boolean       // default: false
  agentBrandName: string        // default: 'BespoxAI' — used in agent paths/filenames/service names
}

export const DEFAULT_BRANDING: BrandingConfig = {
  brandName:      'BespoxAI',
  logoUrl:        null,
  isWhiteLabel:   false,
  agentBrandName: 'BespoxAI',
}

/**
 * Merge a partial partner branding record with defaults.
 * Any null/undefined field falls back to the BespoxAI default.
 */
export function resolveBranding(partial: Partial<BrandingConfig> | null | undefined): BrandingConfig {
  // Only surface partner branding when the partner is white-label.
  // Non-white-label partners' customers (and direct customers) get BespoxAI defaults.
  if (!partial || !partial.isWhiteLabel) return DEFAULT_BRANDING
  return {
    brandName:      partial.brandName      || DEFAULT_BRANDING.brandName,
    logoUrl:        partial.logoUrl        ?? DEFAULT_BRANDING.logoUrl,
    isWhiteLabel:   partial.isWhiteLabel   ?? DEFAULT_BRANDING.isWhiteLabel,
    agentBrandName: partial.agentBrandName || DEFAULT_BRANDING.agentBrandName,
  }
}
