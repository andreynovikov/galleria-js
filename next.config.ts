import type { NextConfig } from 'next'

/*
 * Content Security Policy. Next inlines its bootstrap scripts and React and the lightbox use inline styles, so they
 * need 'unsafe-inline' (a nonce would need it on every page, which would also break static pages); external code
 * is still limited to Google Analytics. Images may come from anywhere over https: /history shows provider avatars.
 * React needs eval in development only, for debugging.
 */
const googleAnalytics = 'https://*.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com'
const contentSecurityPolicy = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' https://*.googletagmanager.com${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https:`,
    "font-src 'self'",
    `connect-src 'self' ${googleAnalytics}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'"
].join('; ')

const nextConfig: NextConfig = {
    basePath: process.env.BASE_PATH,
    output: 'standalone',
    // exifr loads fs/zlib with dynamic require() which does not work when bundled
    serverExternalPackages: ['exifr'],
    // Client Hints are asked for by proxy.ts, with CLIENT_HINTS read at runtime
    async headers() {
        return [
            {
                source: '/:path*',
                headers: [
                    {
                        key: 'content-security-policy',
                        value: contentSecurityPolicy
                    },
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

export default nextConfig
