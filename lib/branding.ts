export interface BrandingConfig {
  brandName:       string        // default: 'BespoxAI'
  logoUrl:         string | null // default: null (use built-in SVG logo)
  primaryColour:   string        // default: '#0A5C46' — maps to --forest
  secondaryColour: string        // default: '#1A9272' — maps to --jade
  isWhiteLabel:    boolean       // default: false
  agentBrandName:  string        // default: 'BespoxAI' — used in agent paths/filenames/service names
}

export const DEFAULT_BRANDING: BrandingConfig = {
  brandName:       'BespoxAI',
  logoUrl:         null,
  primaryColour:   '#0A5C46',
  secondaryColour: '#1A9272',
  isWhiteLabel:    false,
  agentBrandName:  'BespoxAI',
}

const HEX6_RE = /^#[0-9A-Fa-f]{6}$/

/**
 * Merge a partial partner branding record with defaults.
 * Any null/undefined field falls back to the BespoxAI default.
 * Colour fields are validated as 6-digit hex; invalid values fall back to defaults.
 */
export function resolveBranding(partial: Partial<BrandingConfig> | null | undefined): BrandingConfig {
  if (!partial) return DEFAULT_BRANDING
  const primary   = partial.primaryColour   && HEX6_RE.test(partial.primaryColour)   ? partial.primaryColour   : DEFAULT_BRANDING.primaryColour
  const secondary = partial.secondaryColour && HEX6_RE.test(partial.secondaryColour) ? partial.secondaryColour : DEFAULT_BRANDING.secondaryColour
  return {
    brandName:       partial.brandName      || DEFAULT_BRANDING.brandName,
    logoUrl:         partial.logoUrl        ?? DEFAULT_BRANDING.logoUrl,
    primaryColour:   primary,
    secondaryColour: secondary,
    isWhiteLabel:    partial.isWhiteLabel   ?? DEFAULT_BRANDING.isWhiteLabel,
    agentBrandName:  partial.agentBrandName || DEFAULT_BRANDING.agentBrandName,
  }
}
