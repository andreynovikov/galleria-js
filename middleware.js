import { NextResponse } from 'next/server'

import { auth } from '@/auth'

const basePath = process.env.BASE_PATH ?? ''

export default auth((request) => {
    if (request.nextUrl.pathname.startsWith('/history')) {
        if (!request.auth) {
            const callbackUrl=`${basePath}${request.nextUrl.pathname}${request.nextUrl.search}`
            const url = new URL(`${basePath}/api/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`, request.nextUrl.origin)
            return Response.redirect(url)
        }
    } else {
        const url = request.nextUrl.clone()
        url.pathname = '/image' + request.nextUrl.pathname
        return NextResponse.rewrite(url)
    }
})

export const config = {
    matcher: [
        '/(.*\\.(?:jpg|JPG))',
        '/history(.*)'
    ]
}
