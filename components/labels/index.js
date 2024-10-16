'use client'

import { useRouter } from 'next/navigation'

import { TagCloud } from 'react-tagcloud'

import './label-cloud.scss'

const options = {
    luminosity: 'dark',
    hue: '#55ACEE'
}

export default function LabelCloud({ labels }) {
    const router = useRouter()

    const tags = labels.map(label => (
        {
            id: label.id,
            value: label.name,
            count: label.count
        }
    ))

    const handleOnPress = (tag) => {
        router.push(`/?-filt.labels=${tag.id}`)
    }

    return (
        <TagCloud
            tags={tags}
            shuffle={false}
            minSize={12}
            maxSize={24}
            colorOptions={options}
            onClick={handleOnPress} />
    )
}
