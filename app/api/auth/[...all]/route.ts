import { toNextJsHandler } from 'better-auth/next-js'

import { auth } from '@/auth'

const basePath = process.env.BASE_PATH ?? ''

const handlers = toNextJsHandler(auth)

// Next strips BASE_PATH from request URLs, but Better Auth routes and builds redirect URIs with it
function withBasePath(request: Request) {
    const url = new URL(request.url)
    url.pathname = basePath + url.pathname
    return new Request(url, request)
}

export async function GET(request: Request) {
    return await handlers.GET(withBasePath(request))
}

export async function POST(request: Request) {
    return await handlers.POST(withBasePath(request))
}
