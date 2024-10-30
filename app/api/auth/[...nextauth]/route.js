import { NextRequest } from 'next/server'

import { handlers } from '@/auth'

const basePath = process.env.BASE_PATH ?? ''

export async function GET(request, props) {
    let { protocol, host, pathname } = request.nextUrl;

    const headers = request.headers
    // Host rewrite adopted from next-auth/packages/core/src/lib/utils/env.ts:createActionURL
    const detectedHost = headers.get("x-forwarded-host") ?? host
    const detectedProtocol = headers.get("x-forwarded-proto") ?? protocol
    const _protocol = detectedProtocol.endsWith(":")
        ? detectedProtocol
        : detectedProtocol + ":";
    const url = new URL(`${_protocol}//${detectedHost}${basePath}${pathname}${request.nextUrl.search}`)

    return await handlers.GET(new NextRequest(url, request), props)
}

export async function POST(request, props) {
    let { protocol, host, pathname } = request.nextUrl;

    const headers = request.headers
    // Host rewrite adopted from next-auth/packages/core/src/lib/utils/env.ts:createActionURL
    const detectedHost = headers.get("x-forwarded-host") ?? host
    const detectedProtocol = headers.get("x-forwarded-proto") ?? protocol
    const _protocol = detectedProtocol.endsWith(":")
        ? detectedProtocol
        : detectedProtocol + ":";
    const url = new URL(`${_protocol}//${detectedHost}${basePath}${pathname}${request.nextUrl.search}`)

    return await handlers.POST(new NextRequest(url, request), props)
}
