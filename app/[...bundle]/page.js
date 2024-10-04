import { notFound } from 'next/navigation'

import { thumbnailWidths } from '@/lib/image'
import { getImages, syncBundle } from '@/lib/images'
import Album from '@/components/album'

export default async function PhotosList({ params, searchParams }) {
    if (params.bundle.at(-1) === 'thumbs')
        notFound()

    const bundle = params.bundle.join('/')
    const order = searchParams['-nav.order'] || 'stime'

    let images = []
    try {
        images = await syncBundle(bundle)
        images = await getImages({ bundle }, order)
    } catch (e) {
        if (e?.code === 'ENOENT') {
            notFound()
        }
    }

    const photos = images.map((image) => (
        {
            src: `/${image.bundle}/${image.name}`,
            download: `/${image.bundle}/${image.name}?format=original`,
            title: image.name,
            width: image.width,
            height: image.height,
            srcSet: Object.entries(thumbnailWidths).map(([size, width]) => ({
                src: `/${image.bundle}/${image.name}?format=thumbnail&size=${size}`,
                width,
                height: Math.round((image.height / image.width) * width)
            }))
        }
    ))

    return <Album photos={photos} />
}