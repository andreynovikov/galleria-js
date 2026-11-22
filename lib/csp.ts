/*
 * Content Security Policy of pages, sent by proxy.ts with a new nonce for every request. Only scripts carrying the
 * nonce run, and the scripts they load ('strict-dynamic'): Next adds it to its own scripts (it reads it from the
 * request's policy), the layout to Google Analytics. Injected inline scripts and event handler attributes are
 * blocked. 'unsafe-inline' and https: are for browsers without CSP 3, which ignore them when a nonce is given.
 *
 * Styles stay 'unsafe-inline': React and the lightbox set them inline, and styles can't run code. Images may come
 * from anywhere over https: /history shows provider avatars. React needs eval in development only, for debugging.
 *
 * CSP_NONCE=report (the default) keeps enforcing the policy without a nonce and sends the nonce policy as
 * Report-Only, so violations are reported (to /api/csp-report, which logs them) before anything is blocked;
 * CSP_NONCE=enforce enforces the nonce policy.
 */

const googleAnalytics = 'https://*.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com'
const development = process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''

export type CspMode = 'report' | 'enforce'

export const cspMode: CspMode = process.env.CSP_NONCE === 'enforce' ? 'enforce' : 'report'

/** Where browsers send violation reports */
export function cspReportPath(basePath: string) {
    return `${basePath}/api/csp-report`
}

/** A random nonce, new for every page */
export function cspNonce() {
    return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
}

function policy(scripts: string, reportPath: string) {
    return [
        "default-src 'self'",
        `script-src ${scripts}${development}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "font-src 'self'",
        `connect-src 'self' ${googleAnalytics}`,
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'self'",
        // Not report-to: Chrome ignores report-uri when it is given, and sends its batched Reporting API reports only
        // later and not over plain http, while report-uri is sent at once by every browser
        `report-uri ${reportPath}`
    ].join('; ')
}

/** The policy with a nonce */
export function noncePolicy(nonce: string, reportPath: string) {
    return policy(`'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline' https:`, reportPath)
}

/** The policy before nonces: scripts from the app and Google Tag Manager, and any inline script */
export function inlinePolicy(reportPath: string) {
    return policy(`'self' 'unsafe-inline' https://*.googletagmanager.com`, reportPath)
}

/** Response headers of a page with the given nonce */
export function cspHeaders(nonce: string, mode: CspMode, basePath: string): Record<string, string> {
    const reportPath = cspReportPath(basePath)
    const headers: Record<string, string> = {}
    if (mode === 'enforce') {
        headers['content-security-policy'] = noncePolicy(nonce, reportPath)
    } else {
        headers['content-security-policy'] = inlinePolicy(reportPath)
        headers['content-security-policy-report-only'] = noncePolicy(nonce, reportPath)
    }
    return headers
}
