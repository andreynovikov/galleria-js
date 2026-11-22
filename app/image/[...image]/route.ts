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

/** The file, or its bytes from `start` to `end` inclusive */
function streamFile(path: string, range?: { start: number, end: number }) {
    const iterator: AsyncIterator<Buffer> = createReadStream(path, range)[Symbol.asyncIterator]()
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
 * Validator of a file and, for images resized on request, of the variant made from it. It changes when the file is
 * replaced or rewritten (for example, a thumbnail regenerated with `force`). A file sent as it is gets a strong one,
 * which `If-Range` needs to resume downloads; a resized version is only equivalent between sharp versions, so its
 * validator is weak.
 */
function entityTag(stats: Stats, variant?: string) {
    const tag = `"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}${variant ? '-' + variant : ''}"`
    return variant === undefined ? tag : `W/${tag}`
}

/** `Last-Modified` of a file: HTTP dates have whole seconds */
function lastModified(stats: Stats) {
    return new Date(Math.floor(stats.mtimeMs / 1000) * 1000)
}

/** Whether `If-Modified-Since` is at or after the modification time */
function notModifiedSince(ifModifiedSince: string | null, modified: Date) {
    const since = ifModifiedSince === null ? NaN : Date.parse(ifModifiedSince)
    return !Number.isNaN(since) && modified.getTime() <= since
}

/**
 * The byte range asked for in `Range`, `undefined` to send the whole file, or `null` when the range is beyond its end.
 * Only a single range is served; several ranges, a malformed header, or an `If-Range` which doesn't match the current
 * file (by strong comparison, or the exact date) get the whole file, as RFC 9110 allows.
 */
function requestedRange(headers: Headers, size: number, etag: string, modified?: Date) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(headers.get('range')?.trim() ?? '')
    if (match === null || (match[1] === '' && match[2] === ''))
        return undefined
    const ifRange = headers.get('if-range')?.trim()
    if (ifRange !== undefined) {
        const current = ifRange.startsWith('"') || ifRange.startsWith('W/')
            ? !etag.startsWith('W/') && ifRange === etag
            : modified !== undefined && Date.parse(ifRange) === modified.getTime()
        if (!current)
            return undefined
    }
    let start: number, end: number
    if (match[1] === '') {
        // The last bytes
        const length = Number(match[2])
        if (length === 0)
            return null
        start = Math.max(size - length, 0)
        end = size - 1
    } else {
        start = Number(match[1])
        end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1)
        if (end < start)
            return start >= size ? null : undefined
    }
    if (start >= size)
        return null
    return { start, end }
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

    // A file is sent as it is, and can be sent in parts (resumed downloads). A resized version is made only when the
    // browser's copy is outdated: resizing is the expensive part.
    let source: { file: string, stats: Stats, type: string } | { etag: string, make: () => Promise<Buffer> }

    if (format === 'thumbnail') {
        const thumbnail = await image.makeThumbnail(thumbnailSize, vertical, force, restricted)
        source = { file: thumbnail.path, stats: await stat(thumbnail.path), type: thumbnail.type }
        action = restricted ? ACTION_LOCKED : ACTION_THUMBNAIL
    } else if (format === 'original') {
        if (restricted)
            return new Response('Forbidden', {
                status: 403
            })
        source = { file: path, stats, type: 'jpeg' }
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
            // Versions kept in memory still go through this route, so access checks and the log stay the same
            source = {
                etag: entityTag(stats, `${width}${restricted ? '-locked' : ''}`),
                make: () => image.getResizedCached(width, restricted, stats)
            }
            if (restricted)
                action = ACTION_LOCKED
        } else {
            source = { file: path, stats, type: 'jpeg' }
        }
    }
    const etag = 'file' in source ? entityTag(source.stats) : source.etag

    const log = () => after(async () => {
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
    // Not for those: the locked and unlocked screen versions are made from the same file, and a client checking only
    // `If-Modified-Since` could keep the locked one after signing in
    const modified = 'file' in source && !sessionDependent ? lastModified(source.stats) : undefined
    if (modified !== undefined)
        headers.set('last-modified', modified.toUTCString())
    if ('file' in source)
        headers.set('accept-ranges', 'bytes')

    // Views answered from the browser cache are logged too, they are views all the same. `If-Modified-Since` counts
    // only without `If-None-Match`.
    const ifNoneMatch = request.headers.get('if-none-match')
    if (ifNoneMatch !== null ? notModified(ifNoneMatch, etag) : modified !== undefined && notModifiedSince(request.headers.get('if-modified-since'), modified)) {
        log()
        return new Response(null, { status: 304, headers })
    }

    if ('file' in source) {
        headers.set('content-type', 'image/' + source.type)
        const range = requestedRange(request.headers, source.stats.size, etag, modified)
        if (range === null) {
            headers.set('content-range', `bytes */${source.stats.size}`)
            return new Response(null, { status: 416, headers })
        }
        // Download managers fetch a file in many parts: it is logged once, by the part from its start
        if (range === undefined || range.start === 0)
            log()
        if (range !== undefined) {
            headers.set('content-range', `bytes ${range.start}-${range.end}/${source.stats.size}`)
            headers.set('content-length', `${range.end - range.start + 1}`)
            return new Response(streamFile(source.file, range), { status: 206, headers })
        }
        headers.set('content-length', `${source.stats.size}`)
        return new Response(streamFile(source.file), { status: 200, headers })
    }

    log()
    const data = await source.make()
    headers.set('content-type', 'image/jpeg')
    headers.set('content-length', `${data.length}`)
    return new Response(new Blob([new Uint8Array(data)]).stream(), { status: 200, headers })
}
