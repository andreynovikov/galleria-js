import { NextResponse } from 'next/server'

import { auth } from '@/auth'

export default auth((request) => {
    if (request.nextUrl.pathname.startsWith('/history')) {
        if (!request.auth) {
            const newUrl = new URL(`/api/auth/signin?callbackUrl=${request.nextUrl}`, request.nextUrl.origin)
            return Response.redirect(newUrl)
        }
    } else {
        const updatedUrl = request.nextUrl.clone()
        updatedUrl.pathname = '/image' + request.nextUrl.pathname
        return NextResponse.rewrite(updatedUrl)
    }
})

export const config = {
    matcher: [
        '/(.*\\.(?:jpg|JPG))',
        '/history(.*)'
    ]
}
