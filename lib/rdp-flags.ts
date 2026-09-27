// lib/rdp-flags.ts — RDP feature flags with no server-only imports, so client
// components (e.g. the partner client page) can read them as well as API routes.

// Interim kill switch (security item 2c). Provisioning publishes
// {sub}-rdp.bespoxai.com -> rdp://localhost:3389 with no Cloudflare Access
// policy, so anyone running `cloudflared access rdp` can reach the server.
// Off until Access gating, Independent MFA and customer consent ship.
export const RDP_PROVISIONING_ENABLED = false
export const RDP_PROVISIONING_DISABLED_MESSAGE =
  'RDP provisioning is temporarily disabled while access controls are being added.'
