import { NextResponse, type NextRequest } from 'next/server'

import { getSessionFromHeaders } from './auth'

const basePath = process.env.BASE_PATH ?? ''

export async function proxy(request: NextRequest) {
    if (request.method === 'POST') // Do not intercept next.js requests
        return
    // Filtering by restricted labels requires signing in too, that is checked by Gallery, which resolves label ids
    if (request.nextUrl.pathname.startsWith('/history')) {
        if (!await getSessionFromHeaders(request.headers)) {
            const callbackUrl = `${basePath}${request.nextUrl.pathname}${request.nextUrl.search}`
            const url = new URL(`${basePath}/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`, request.nextUrl.origin)
            return Response.redirect(url)
        }
    } else if (request.nextUrl.pathname.toLowerCase().endsWith('.jpg')) {
        const url = request.nextUrl.clone()
        url.pathname = '/image' + request.nextUrl.pathname
        return NextResponse.rewrite(url)
    }
}

export const config = {
    matcher: [
        '/', // Required if base path is set
        '/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)'
    ]
}
