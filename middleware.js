import { NextResponse } from 'next/server'

import { auth } from '@/auth'

const basePath = process.env.BASE_PATH ?? ''
const restrictedLabels = new Set(process.env.RESTRICTED_LABELS?.split(',') ?? [])

export default auth((request) => {
    if (request.method === 'POST') // Do not intercept next.js requests
        return
    const labels = request.nextUrl.searchParams.get('-filt.labels')?.split(',') ?? []
    if (request.nextUrl.pathname.startsWith('/history') || labels.filter(Set.prototype.has, restrictedLabels).length > 0) {
        if (!request.auth) {
            const callbackUrl=`${basePath}${request.nextUrl.pathname}${request.nextUrl.search}`
            const url = new URL(`${basePath}/api/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`, request.nextUrl.origin)
            return Response.redirect(url)
        }
    } else if (request.nextUrl.pathname.toLowerCase().endsWith('.jpg')) {
        const url = request.nextUrl.clone()
        url.pathname = '/image' + request.nextUrl.pathname
        return NextResponse.rewrite(url)
    }
})

export const config = {
    matcher: [
        '/', // Required if base path is set
        '/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)'
    ]
}
