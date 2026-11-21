import { useState, useEffect, Fragment, type HTMLAttributes, type ReactNode } from 'react'
import Link from 'next/link'

import PulseLoader from 'react-spinners/PulseLoader'

import { getImage } from '@/lib/actions'
import type { ImageInfo } from '@/lib/image'

function Loading() {
    return <PulseLoader color="white" size={10} />
}

interface ImageDescriptionProps extends Omit<HTMLAttributes<HTMLDivElement>, 'id'> {
    id: number
}

export default function ImageDescription({ id, ...props }: ImageDescriptionProps) {
    const [image, setImage] = useState<ImageInfo | null>(null)

    useEffect(() => {
        getImage(id).then(data => setImage(data))
    }, [id])

    const info: { key: string, value: ReactNode }[] = []

    if (image?.description)
        info.push({
            key: 'title',
            value: image.description
        })

    if (image?.labels && image.labels.length > 0)
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
        if (image.info.FocalLength !== undefined) {
            exif.push(image.info.FocalLength + 'mm')
        }
        if (image.info.ISO !== undefined) {
            exif.push('ISO ' + image.info.ISO)
        }
        if (image.info.ExposureTime !== undefined) {
            if (image.info.ExposureTime < 1) {
                exif.push('1/' + Math.floor(1 / image.info.ExposureTime) + 's')
            } else {
                exif.push(image.info.ExposureTime + 's')
            }
        }
        if (image.info.FNumber !== undefined) {
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
