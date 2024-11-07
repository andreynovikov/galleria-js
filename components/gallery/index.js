import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import Link from 'next/link'

import Album from '@/components/album'
import NothingFound from './nothing-found'

import { getLabelMaps, listImages } from 'lib/db'
import { thumbnailWidths } from '@/lib/image'
import { syncBundle } from '@/lib/images'
import { bool } from '@/lib/utils'
import { auth } from '@/auth'

import styles from './gallery.module.scss'

const basePath = process.env.BASE_PATH ?? ''

export default async function Gallery({ bundle, searchParams }) {
    const session = await auth()
    const user = session?.user ?? {}
    const header = headers()
    user.ip = (header.get('x-real-ip') ?? header.get('x-forwarded-for') ?? '127.0.0.1').split(',')[0]

    const labelIds = await getLabelMaps()

    let labels = searchParams['-filt.labels']
    if (labels !== undefined) {
        labels = labels.split(',').map(l => {
            if (isNaN(l))
                l = labelIds[l] ?? 0
            return +l
        }).filter(l => l > 0)
    }
    let notlabels = searchParams['-filt.notlabels']
    if (notlabels !== undefined)
        notlabels = notlabels.split(',').filter(l => +l > 0)
    let from = searchParams['-filt.from']
    if (from !== undefined)
        from = new Date(from) || undefined
    let till = searchParams['-filt.till']
    if (till !== undefined)
        till = new Date(till) || undefined
    let censored = searchParams['-filt.censored']
    if (censored !== undefined)
        censored = +censored

    const order = searchParams['-nav.order'] || 'stime'

    if (bundle && labels === undefined && notlabels === undefined && censored === undefined) {
        try {
            const shouldUpdateMetadata = bool(searchParams['updatemetadata'])
            await syncBundle(bundle, shouldUpdateMetadata)
        } catch (e) {
            if (e?.code === 'ENOENT') {
                notFound()
            }
        }
    }

    const images = await listImages({ bundle, labels, notlabels, from, till, censored }, order)

    if (images.length === 0)
        return <NothingFound />

    const photos = images.map((image) => (
        {
            id: image.id,
            src: `${basePath}${image.bundle}/${image.name}`,
            download: `${basePath}${image.bundle}/${image.name}?format=original`,
            title: image.name,
            width: image.width,
            height: image.height,
            srcSet: Object.entries(thumbnailWidths).map(([size, width]) => ({
                src: `${basePath}${image.bundle}/${image.name}?format=thumbnail&size=${size}`,
                width,
                height: Math.round((image.height / image.width) * width)
            })).concat([{
                src: `${basePath}${image.bundle}/${image.name}`,
                width: Number(process.env.SCREEN_MAX_WIDTH),
                height: Math.round((image.height / image.width) * Number(process.env.SCREEN_MAX_WIDTH))
            }])
        }
    ))

    return (
        <>
            <div className={styles.topMenu}>
                <Link href="/">Все альбомы</Link>
            </div>
            <Album photos={photos} user={user} />
        </>
    )
}
