import { createReadStream, type Stats } from 'fs'
import { stat } from 'fs/promises'
import { join } from 'path'

import { after, type NextRequest } from 'next/server'

import { censorshipLevel, getSession, isAdmin } from '@/auth'

import Image, { ImageNotFoundError } from '@/lib/image'
import { getRestrictedLabels, writeLog } from '@/lib/db'
import { bool, clientIp, decodePath, uaMeta, ACTION_ORIGINAL, ACTION_VIEW, ACTION_EXPORT, ACTION_THUMBNAIL, ACTION_LOCKED } from '@/lib/utils'

const screenMaxWidth = Number(process.env.SCREEN_MAX_WIDTH)
const exportMaxWidth = Number(process.env.EXPORT_MAX_WIDTH)
const screenDelta = Number(process.env.SCREEN_DELTA)
/** How long browsers and shared caches may use an image without asking again, in seconds */
const maxAge = 60 * 60

/*
 * https://www.ericburel.tech/blog/nextjs-stream-files#moving-to-route-handlers-its-not-that-easy
 */

function streamFile(path: string) {
    const iterator: AsyncIterator<Buffer> = createReadStream(path)[Symbol.asyncIterator]()
    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            const { value, done } = await iterator.next()
            if (done)
                controller.close()
            else
                controller.enqueue(new Uint8Array(value))
        },
        async cancel() {
            await iterator.return?.()
        }
    })
}

/**
 * Weak validator of a file and, for images resized on request, of the variant made from it. It changes when the file
 * is replaced or rewritten (for example, a thumbnail regenerated with `force`).
 */
function entityTag(stats: Stats, variant = '') {
    return `W/"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}${variant && '-' + variant}"`
}

/** Whether `If-None-Match` matches the validator, by weak comparison */
function notModified(ifNoneMatch: string | null, etag: string) {
    if (ifNoneMatch === null)
        return false
    if (ifNoneMatch.trim() === '*')
        return true
    const opaque = (tag: string) => tag.trim().replace(/^W\//, '')
    return ifNoneMatch.split(',').some(tag => opaque(tag) === opaque(etag))
}

export async function GET(request: NextRequest) {
    const session = await getSession()
    const ip = clientIp(request.headers)
    const format = request.nextUrl.searchParams.get('format')
    const ratioParam = request.nextUrl.searchParams.get('ratio')
    const ratio = ratioParam === null ? 1 : Number(ratioParam)
    if (!(ratio > 0 && ratio <= 1))
        return new Response('Bad request', {
            status: 400
        })
    const thumbnailSize = request.nextUrl.searchParams.get('size') ?? 'm'
    const vertical = request.nextUrl.searchParams.get('constraint') === 'vertical'
    // Regenerating thumbnails is expensive, so only admins may force it
    const force = isAdmin(session) && bool(request.nextUrl.searchParams.get('force'))
    // The URL path is percent-encoded
    const photoPath = decodePath(request.nextUrl.pathname.split('/').filter(segment => segment !== ''))
    if (photoPath === null)
        return new Response('Not found', {
            status: 404
        })
    const image = Image.fromPath(photoPath)
    let action: number
    let restricted = false

    // Check the file first: a missing file has no database record to look up labels for
    const path = join(process.env.PHOTOS_FOLDER as string, photoPath)
    let stats: Stats
    try {
        stats = await stat(path)
    } catch (e) {
        if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') {
            return new Response('Not found', {
                status: 404
            })
        } else {
            console.log(e)
            return new Response('Server error', {
                status: 500
            })
        }
    }

    // Censored photos are reported as missing, so their names can not be probed. Files which are not synced
    // yet have no censorship level, they are not served either.
    try {
        await image.fetchData()
    } catch (e) {
        if (!(e instanceof ImageNotFoundError))
            throw e
        return new Response('Not found', {
            status: 404
        })
    }
    if ((image.censored ?? 0) > censorshipLevel(session))
        return new Response('Not found', {
            status: 404
        })

    // Photos with restricted labels are blurred for anonymous visitors only
    let hasRestrictedLabel = false
    const restrictedLabels = await getRestrictedLabels()
    if (restrictedLabels.length > 0) {
        const labels = await image.fetchLabels()
        hasRestrictedLabel = labels.some(label => restrictedLabels.includes(label.id))
        restricted = hasRestrictedLabel && !session?.user
    }
    const sessionDependent = hasRestrictedLabel || (image.censored ?? 0) > 0

    // The response body is made only when the browser's copy is outdated: resizing is the expensive part
    let etag: string
    let body: () => Promise<{ type: string, size: number, stream: ReadableStream }>
    const original = async () => ({ type: 'jpeg', size: stats.size, stream: streamFile(path) })

    if (format === 'thumbnail') {
        const thumbnail = await image.makeThumbnail(thumbnailSize, vertical, force, restricted)
        etag = entityTag(await stat(thumbnail.path))
        body = async () => ({ type: thumbnail.type, size: thumbnail.size, stream: streamFile(thumbnail.path) })
        action = restricted ? ACTION_LOCKED : ACTION_THUMBNAIL
    } else if (format === 'original') {
        if (restricted)
            return new Response('Forbidden', {
                status: 403
            })
        etag = entityTag(stats)
        body = original
        action = ACTION_ORIGINAL
    } else {
        let width = screenMaxWidth

        if (format === 'export') {
            width = exportMaxWidth
            action = ACTION_EXPORT
        } else {
            action = ACTION_VIEW
        }

        const imageWidth = image.width ?? 0
        const imageHeight = image.height ?? 0

        if (ratio < 1)
            width = Math.round(width * ratio)
        if (imageWidth < imageHeight)
            width = Math.round(imageWidth / imageHeight * width)
        width = Math.max(width, 1)
        if (imageWidth > width * screenDelta || restricted) {
            etag = entityTag(stats, `${width}${restricted ? '-locked' : ''}`)
            // Versions kept in memory still go through this route, so access checks and the log stay the same
            body = async () => {
                const data = await image.getResizedCached(width, restricted, stats)
                return { type: 'jpeg', size: data.length, stream: new Blob([new Uint8Array(data)]).stream() }
            }
            if (restricted)
                action = ACTION_LOCKED
        } else {
            etag = entityTag(stats)
            body = original
        }
    }

    after(async () => {
        const meta = uaMeta(request.headers)
        await writeLog(await image.getId(), action, ip, session?.user, meta)
    })

    // Restricted and censored photos are served differently depending on the visitor: shared caches must not store
    // them, and browsers must check them every time, so that signing in or out takes effect (the validator differs
    // between locked and unlocked versions)
    const headers = new Headers({
        'etag': etag,
        'cache-control': sessionDependent ? 'private, no-cache' : `public, max-age=${maxAge}`
    })
    if (sessionDependent)
        headers.set('vary', 'Cookie')

    // Views answered from the browser cache are logged too, they are views all the same
    if (notModified(request.headers.get('if-none-match'), etag))
        return new Response(null, { status: 304, headers })

    const { type, size, stream } = await body()
    headers.set('content-type', 'image/' + type)
    headers.set('content-length', size + '')
    return new Response(stream, { status: 200, headers })
}
