import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import Link from 'next/link'

import Album, { type AlbumPhoto } from '@/components/album'
import NothingFound from './nothing-found'

import { getLabelMaps, listImages } from '@/lib/db'
import { thumbnailWidths } from '@/lib/image'
import { syncBundle } from '@/lib/images'
import { bool, clientIp, param, uaMeta, type SearchParams } from '@/lib/utils'
import { auth } from '@/auth'

import GaEvent from './ga-event'
import styles from './gallery.module.scss'

const basePath = process.env.BASE_PATH ?? ''

function parseDate(value?: string) {
    if (value === undefined)
        return undefined
    const date = new Date(value)
    return isNaN(date.getTime()) ? undefined : date
}

interface GalleryProps {
    bundle?: string
    searchParams: SearchParams
}

export default async function Gallery({ bundle, searchParams }: GalleryProps) {
    const session = await auth()
    const header = await headers()
    const meta = uaMeta(header)
    const ip = clientIp(header)
    const labelIds = await getLabelMaps()

    const labels = param(searchParams, '-filt.labels')?.split(',').map(l => {
        if (isNaN(+l))
            return labelIds[l] ?? 0
        return +l
    }).filter(l => l > 0)
    const notlabels = param(searchParams, '-filt.notlabels')?.split(',').map(Number).filter(l => l > 0)
    const from = parseDate(param(searchParams, '-filt.from'))
    const till = parseDate(param(searchParams, '-filt.till'))
    const censoredParam = param(searchParams, '-filt.censored')
    let censored = censoredParam !== undefined ? +censoredParam : undefined

    if (bundle && labels === undefined && notlabels === undefined && censored === undefined) {
        try {
            const shouldUpdateMetadata = bool(param(searchParams, 'updatemetadata'))
            await syncBundle(bundle, shouldUpdateMetadata)
        } catch (e) {
            if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') {
                notFound()
            }
        }
    }

    if (censored === undefined && session?.user?.censorship !== undefined)
        censored = session.user.censorship

    const order = param(searchParams, '-nav.order') || 'stime'

    const images = await listImages({ bundle, labels, notlabels, from, till, censored }, order)

    if (images.length === 0)
        return <NothingFound />

    const sid = session?.user?.id ?? ''

    const photos: AlbumPhoto[] = images.map((image) => (
        {
            id: image.id,
            src: `${basePath}${image.bundle}/${image.name}?sid=${sid}`,
            download: image.restricted && session?.user?.id === undefined ? false : `${basePath}${image.bundle}/${image.name}?format=original`,
            title: image.name,
            width: image.width,
            height: image.height,
            restricted: image.restricted ?? false,
            srcSet: Object.entries(thumbnailWidths).map(([size, width]) => ({
                src: `${basePath}${image.bundle}/${image.name}?format=thumbnail&size=${size}&sid=${sid}`,
                width,
                height: Math.round((image.height / image.width) * width)
            })).concat([{
                src: `${basePath}${image.bundle}/${image.name}?sid=${sid}`,
                width: Number(process.env.SCREEN_MAX_WIDTH),
                height: Math.round((image.height / image.width) * Number(process.env.SCREEN_MAX_WIDTH))
            }])
        }
    ))

    let gaEvent = null
    if (process.env.GOOGLE_ANALYTICS_ID) {
        const params = Object.entries(searchParams).map(([key, value]) => (
            ([] as string[]).concat(value ?? []).map(v => `${encodeURIComponent(key)}=${encodeURIComponent(v)}`
        ))).flat().join('&')
        const path = `${bundle ?? '/'}${params && '?'}${params}`

        gaEvent = <GaEvent event="list_photos" label={path} value={photos.length} />
    }

    return (
        <>
            <div className={styles.topMenu}>
                <Link href="/">Все альбомы</Link>
            </div>
            <Album photos={photos} ip={ip} user={session?.user} meta={meta} basePath={basePath} />
            {gaEvent}
        </>
    )
}
