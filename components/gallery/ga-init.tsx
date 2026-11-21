'use client'

import { useEffect } from 'react'
import { GoogleAnalytics } from '@next/third-parties/google'
import { setCookie } from 'cookies-next/client'

declare global {
    function gtag(command: 'get', targetId: string, fieldName: string, callback: (value: string) => void): void
}

export default function GaInit({ gaId }: { gaId: string }) {
    useEffect(() => {
        if (typeof gtag !== 'function')
            return

        gtag('get', gaId, 'client_id', (client_id) => {
            setCookie('ga_client_id', client_id, { sameSite: 'lax' })
        })
    }, [gaId])

    return <GoogleAnalytics gaId={gaId} />
}
