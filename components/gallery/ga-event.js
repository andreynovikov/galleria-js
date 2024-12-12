'use client'

import { useEffect } from 'react'
import { sendGAEvent } from '@next/third-parties/google'

export default function GaEvent(props) {
    const { event, label, value } = props

    useEffect(() => {
        setTimeout(() => { // data layer is not yet initialized on first page load
            sendGAEvent('event', event, {
                event_category: 'galleria',
                event_label: label,
                value
            })
        }, 100)
    }, [event, label, value])

    return null
}