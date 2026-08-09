/** @type {import('next').NextConfig} */
const nextConfig = {
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
