export interface BrandingConfig {
  brandName:      string        // default: 'BespoxAI'
  logoUrl:        string | null // default: null (use built-in SVG logo)
  primaryColour:  string        // default: '#1B4F8C'
  isWhiteLabel:   boolean       // default: false
  agentBrandName: string        // default: 'BespoxAI' — used in agent paths/filenames/service names
}

export const DEFAULT_BRANDING: BrandingConfig = {
  brandName:      'BespoxAI',
  logoUrl:        null,
  primaryColour:  '#1B4F8C',
  isWhiteLabel:   false,
  agentBrandName: 'BespoxAI',
}

/**
 * Merge a partial partner branding record with defaults.
 * Any null/undefined field falls back to the BespoxAI default.
 */
export function resolveBranding(partial: Partial<BrandingConfig> | null | undefined): BrandingConfig {
  if (!partial) return DEFAULT_BRANDING
  return {
    brandName:      partial.brandName      || DEFAULT_BRANDING.brandName,
    logoUrl:        partial.logoUrl        ?? DEFAULT_BRANDING.logoUrl,
    primaryColour:  partial.primaryColour  || DEFAULT_BRANDING.primaryColour,
    isWhiteLabel:   partial.isWhiteLabel   ?? DEFAULT_BRANDING.isWhiteLabel,
    agentBrandName: partial.agentBrandName || DEFAULT_BRANDING.agentBrandName,
  }
}
