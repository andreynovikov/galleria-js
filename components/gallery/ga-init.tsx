'use client'

import { useEffect } from 'react'
import { GoogleAnalytics } from '@next/third-parties/google'
import { setCookie } from 'cookies-next/client'

declare global {
    function gtag(command: 'get', targetId: string, fieldName: string, callback: (value: string) => void): void
}

interface GaInitProps {
    gaId: string
    /** `BASE_PATH`, which client code can't read */
    basePath: string
    /** Nonce of the page's Content Security Policy, for the Google Analytics scripts */
    nonce?: string
}

export default function GaInit({ gaId, basePath, nonce }: GaInitProps) {
    useEffect(() => {
        if (typeof gtag !== 'function')
            return

        // The server reads it when sign-in completes, to send the login event (lib/ga.ts). Lax lets the redirect
        // back from the sign-in provider carry it.
        gtag('get', gaId, 'client_id', (client_id) => {
            setCookie('ga_client_id', client_id, {
                sameSite: 'lax',
                secure: window.location.protocol === 'https:',
                path: basePath || '/'
            })
        })
    }, [gaId, basePath])

    return <GoogleAnalytics gaId={gaId} nonce={nonce} />
}
