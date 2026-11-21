import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'

import Album, { type AlbumPhoto } from '@/components/album'
import NothingFound from './nothing-found'

import { getRestrictedLabels, listImages, resolveLabels } from '@/lib/db'
import { downloadMaxImages, thumbnailWidths } from '@/lib/image'
import { syncBundle } from '@/lib/images'
import { bool, param, queryString, type SearchParams } from '@/lib/utils'
import { censorshipLevel, getSession, isAdmin } from '@/auth'

import GaEvent from './ga-event'
import styles from './gallery.module.css'

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
    const session = await getSession()

    const labelsParam = param(searchParams, '-filt.labels')
    const labels = labelsParam !== undefined ? await resolveLabels(labelsParam.split(',')) : undefined
    const query = queryString(searchParams)

    // Filtering by restricted label requires signing in. It is checked after resolving labels, because they can be
    // given both by name and by id.
    if (!session && labels !== undefined && labels.length > 0) {
        const restrictedLabels = await getRestrictedLabels()
        if (labels.some(label => restrictedLabels.includes(label))) {
            const callbackUrl = `${basePath}${bundle ?? '/'}?${query}`
            redirect(`/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`)
        }
    }
    const notlabels = param(searchParams, '-filt.notlabels')?.split(',').map(Number).filter(l => l > 0)
    const from = parseDate(param(searchParams, '-filt.from'))
    const till = parseDate(param(searchParams, '-filt.till'))
    const censoredParam = param(searchParams, '-filt.censored')
    // The filter can only lower the visitor's own censorship level
    const level = censorshipLevel(session)
    const requested = Number(censoredParam)
    const censored = censoredParam !== undefined && Number.isInteger(requested) ? Math.max(0, Math.min(requested, level)) : level

    if (bundle && labels === undefined && notlabels === undefined && censoredParam === undefined) {
        try {
            // Re-reading metadata of the whole album is expensive, so only admins may ask for it
            const shouldUpdateMetadata = isAdmin(session) && bool(param(searchParams, 'updatemetadata'))
            await syncBundle(bundle, shouldUpdateMetadata)
        } catch (e) {
            if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') {
                notFound()
            }
        }
    }

    const order = param(searchParams, '-nav.order') || 'stime'

    const images = await listImages({ bundle, labels, notlabels, from, till, censored }, order)

    if (images.length === 0)
        return <NothingFound />

    const photos: AlbumPhoto[] = images.map((image) => (
        {
            id: image.id,
            src: `${basePath}${image.bundle}/${image.name}`,
            download: image.restricted && session?.user?.id === undefined ? false : `${basePath}${image.bundle}/${image.name}?format=original`,
            title: image.name,
            width: image.width,
            height: image.height,
            restricted: image.restricted ?? false,
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

    let gaEvent = null
    if (process.env.GOOGLE_ANALYTICS_ID) {
        const path = `${bundle ?? '/'}${query && '?'}${query}`

        gaEvent = <GaEvent event="list_photos" label={path} value={photos.length} />
    }

    return (
        <>
            <div className={styles.topMenu}>
                <Link href="/">Все альбомы</Link>
            </div>
            <Album photos={photos} signedIn={!!session} downloadable={!!session && photos.length <= downloadMaxImages} basePath={basePath} />
            {gaEvent}
        </>
    )
}
