import { useState, useEffect, Fragment } from 'react'
import Link from 'next/link'

import PulseLoader from 'react-spinners/PulseLoader'

import { getImage } from '@/lib/actions'

function Loading() {
    return <PulseLoader color="white" size={10} />
}

export default function ImageDescription({ id, ...props }) {
    const [image, setImage] = useState({})

    useEffect(() => {
        getImage(id).then(data => setImage(data))
    }, [])

    const info = []

    if (image?.description)
        info.push({
            key: 'title',
            value: image.description
        })

    if (image?.labels?.length > 0)
        info.push({
            key: 'labels',
            value: image.labels.map((label, index) => (
                <Fragment key={label.id}>
                    {index > 0 && ', '}
                    <Link href={`/?-filt.labels=${label.id}&opener=${image.id}`} key={label.id}>{label.name}</Link>
                </Fragment>
            ))
        })

    if (image?.info) {
        const exif = []
        if ('FocalLength' in image.info) {
            exif.push(image.info.FocalLength + 'mm')
        }
        if ('ISO' in image.info) {
            exif.push('ISO ' + image.info.ISO)
        }
        if ('ExposureTime' in image.info) {
            if (image.info.ExposureTime < 1) {
                exif.push('1/' + Math.floor(1 / image.info.ExposureTime) + 's')
            } else {
                exif.push(image.info.ExposureTime + 's')
            }
        }
        if ('FNumber' in image.info) {
            exif.push('f/' + image.info.FNumber)
        }
        if (exif.length > 0)
            info.push({
                key: 'exif',
                value: exif.join(', ')
            })
    }

    return <div {...props}>
        {image?.id ? (
            info.map((part, index) => (
                <Fragment key={part.key}>
                    {index > 0 && ' ∷ '}
                    <span className={part.key}>
                        {part.value}
                    </span>
                </Fragment>
            ))
        ) : (
            <Loading />
        )}
    </div>
}
