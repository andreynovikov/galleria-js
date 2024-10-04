import { NextResponse } from 'next/server'

export default function middleware(request) {
    const updatedUrl = request.nextUrl.clone();
    updatedUrl.pathname = '/image' + request.nextUrl.pathname;

    return NextResponse.rewrite(updatedUrl);
}

export const config = {
    matcher: ['/(.*\\.(?:jpg|JPG))']
}
