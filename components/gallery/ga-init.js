'use client'

import { useEffect } from 'react'
import { GoogleAnalytics } from '@next/third-parties/google'
import { setCookie } from 'cookies-next/client'

export default function GaInit(props) {
    const { gaId } = props

    useEffect(() => {
        if (typeof gtag !== 'function')
            return

        gtag('get', gaId, 'client_id', (client_id) => {
            setCookie('ga_client_id', client_id, { sameSite: 'lax' })
        })
    }, [])

    return <GoogleAnalytics gaId={gaId} />
}
