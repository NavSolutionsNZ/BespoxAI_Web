/** @type {import('next').NextConfig} */
const nextConfig = {
  // The installer routes read these scripts at request time; make sure the
  // serverless bundles include them (the uninstaller ships in every zip).
  outputFileTracingIncludes: {
    '/api/settings/installer':             ['./scripts/Install-BespoxAI.ps1', './scripts/Uninstall-BespoxAI.ps1', './scripts/Uninstall-BespoxAI.bat'],
    '/api/partner/tenants/[id]/installer': ['./scripts/Install-BespoxAI.ps1', './scripts/Uninstall-BespoxAI.ps1', './scripts/Uninstall-BespoxAI.bat'],
    '/api/admin/installer/[tenantId]':     ['./scripts/Install-BespoxAI.ps1', './scripts/Uninstall-BespoxAI.ps1', './scripts/Uninstall-BespoxAI.bat'],
  },
  async rewrites() {
    return {
      beforeFiles: [
        { source: '/about', destination: '/about.html' },
        { source: '/faq', destination: '/faq.html' },
        { source: '/terms', destination: '/terms.html' },
      ],
    }
  },
}

module.exports = nextConfig
