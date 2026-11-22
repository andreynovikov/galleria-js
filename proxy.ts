import { NextResponse, type NextRequest } from 'next/server'

import { getSessionFromHeaders } from './auth'

const basePath = process.env.BASE_PATH ?? ''

/**
 * Client Hints that pages ask browsers for (`CLIENT_HINTS`, comma-separated), for the device and browser shown in
 * `/history`. Chromium browsers send the brand, major version, platform and mobile flag anyway; the others have to be
 * asked for, and are sent from the next request on (images and server actions, which are what gets logged).
 */
const clientHints = (process.env.CLIENT_HINTS ?? '')
    .split(',')
    .map(hint => hint.trim())
    .filter(hint => /^Sec-CH-[A-Za-z-]+$/i.test(hint))
    .join(', ')

export async function proxy(request: NextRequest) {
    if (request.method === 'POST') // Do not intercept next.js requests
        return
    // Next fails with 500 on a malformed percent-encoding while matching routes
    try {
        decodeURIComponent(request.nextUrl.pathname)
    } catch {
        return new Response('Bad request', { status: 400 })
    }
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
    // Not Critical-CH: browsers would repeat the first request of a visit to send the hints, which only the log uses
    if (clientHints !== '') {
        const response = NextResponse.next()
        response.headers.set('accept-ch', clientHints)
        return response
    }
}

export const config = {
    matcher: [
        '/', // Required if base path is set
        '/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)'
    ]
}
