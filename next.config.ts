import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const nextConfig: NextConfig = {
    basePath: process.env.BASE_PATH,
    output: 'standalone',
    // exifr loads fs/zlib with dynamic require() which does not work when bundled
    serverExternalPackages: ['exifr'],
    // The Content Security Policy of pages (with a nonce per request, lib/csp.ts) and Client Hints are sent by
    // proxy.ts. Image responses can't run scripts, and nosniff keeps them from being taken for anything else.
    async headers() {
        return [
            {
                source: '/:path*',
                headers: [
                    {
                        // For browsers without frame-ancestors support
                        key: 'x-frame-options',
                        value: 'SAMEORIGIN'
                    },
                    {
                        key: 'referrer-policy',
                        value: 'strict-origin-when-cross-origin'
                    },
                    {
                        key: 'x-content-type-options',
                        value: 'nosniff'
                    }
                ]
            }
        ]
    }
}

// Aliases next-intl/config to i18n/request.ts, which picks the interface language of each request
const withNextIntl = createNextIntlPlugin()

export default withNextIntl(nextConfig)
