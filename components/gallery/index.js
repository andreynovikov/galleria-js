import { notFound } from 'next/navigation'

import Album from '@/components/album'
import NothingFound from './nothing-found'

import { thumbnailWidths } from '@/lib/image'
import { getImages, syncBundle } from '@/lib/images'
import { bool } from '@/lib/utils'

export default async function Gallery({bundle, searchParams}) {
    let labels = searchParams['-filt.labels']
    if (labels !== undefined)
        labels = labels.split(',').filter(l => +l > 0)
    let notlabels = searchParams['-filt.notlabels']
    if (notlabels !== undefined)
        notlabels = notlabels.split(',').filter(l => +l > 0)
    let from = searchParams['-filt.from']
    if (from !== undefined)
        from = new Date(from) || undefined
    let till = searchParams['-filt.till']
    if (till !== undefined)
        till = new Date(till) || undefined

    const order = searchParams['-nav.order'] || 'stime'

    if (bundle && !!!labels && !!!notlabels) {
        try {
            const shouldUpdateMetadata = bool(searchParams['updatemetadata'])
            await syncBundle(bundle, shouldUpdateMetadata)
        } catch (e) {
            if (e?.code === 'ENOENT') {
                notFound()
            }
        }
    }

    const images = await getImages({ bundle, labels, notlabels, from, till }, order)

    if (images.length === 0)
        return <NothingFound />

    const photos = images.map((image) => (
        {
            id: image.id,
            src: `${image.bundle}/${image.name}`,
            download: `${image.bundle}/${image.name}?format=original`,
            title: image.name,
            width: image.width,
            height: image.height,
            srcSet: Object.entries(thumbnailWidths).map(([size, width]) => ({
                src: `${image.bundle}/${image.name}?format=thumbnail&size=${size}`,
                width,
                height: Math.round((image.height / image.width) * width)
            })).concat([{
                src: `${image.bundle}/${image.name}`,
                width: Number(process.env.SCREEN_MAX_WIDTH),
                height: Math.round((image.height / image.width) * Number(process.env.SCREEN_MAX_WIDTH))
            }])
        }
    ))

    return (
        <Album photos={photos} />
    )
}