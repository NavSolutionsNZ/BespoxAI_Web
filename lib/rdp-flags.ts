// lib/rdp-flags.ts — RDP feature flags with no server-only imports, so client
// components (e.g. the partner client page) can read them as well as API routes.

// Kill switch for partner RDP provisioning (security item 2c). Provisioning
// now puts {sub}-rdp.bespoxai.com behind Cloudflare Access (One-time PIN +
// Independent MFA + the portal live check) and requires customer consent —
// see lib/rdp-access.ts. Set to false to stop partners provisioning again
// without touching superadmin provisioning.
export const RDP_PROVISIONING_ENABLED = true
export const RDP_PROVISIONING_DISABLED_MESSAGE =
  'RDP provisioning is temporarily disabled while access controls are being added.'
