import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { join } from 'path'

import { after, type NextRequest } from 'next/server'

import { getSession } from '@/auth'

import Image from '@/lib/image'
import { getRestrictedLabels, writeLog } from '@/lib/db'
import { bool, clientIp, uaMeta, ACTION_ORIGINAL, ACTION_VIEW, ACTION_EXPORT, ACTION_THUMBNAIL, ACTION_LOCKED } from '@/lib/utils'

const screenMaxWidth = Number(process.env.SCREEN_MAX_WIDTH)
const exportMaxWidth = Number(process.env.EXPORT_MAX_WIDTH)
const screenDelta = Number(process.env.SCREEN_DELTA)

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

export async function GET(request: NextRequest) {
    const session = await getSession()
    const ip = clientIp(request.headers)
    const format = request.nextUrl.searchParams.get('format')
    const ratio = +(request.nextUrl.searchParams.get('ratio') ?? 1.0)
    const thumbnailSize = request.nextUrl.searchParams.get('size') ?? 'm'
    const vertical = request.nextUrl.searchParams.get('constraint') === 'vertical'
    const force = bool(request.nextUrl.searchParams.get('force'))
    const image = Image.fromPath(request.nextUrl.pathname)
    let path: string
    let stream: ReadableStream
    let size: number
    let type: string
    let action: number
    let restricted = false

    // Check the file first: a missing file has no database record to look up labels for
    path = join(process.env.PHOTOS_FOLDER as string, request.nextUrl.pathname)
    try {
        const stats = await stat(path)
        size = stats.size
        type = 'jpeg'
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

    if (!session?.user && process.env.RESTRICTED_LABELS !== undefined) {
        const restrictedLabels = await getRestrictedLabels()
        const labels = await image.fetchLabels()
        restricted = labels.some(label => restrictedLabels.includes(label.id))
    }

    if (format === 'thumbnail') {
        ({ type, size, path } = await image.makeThumbnail(thumbnailSize, vertical, force, restricted))
        stream = streamFile(path)
        action = restricted ? ACTION_LOCKED : ACTION_THUMBNAIL
    } else {
        if (format === 'original') {
            if (restricted)
                return new Response('Forbidden', {
                    status: 403
                })
            stream = streamFile(path)
            action = ACTION_ORIGINAL
        } else {
            await image.fetchData()

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
            if (imageWidth > width * screenDelta || restricted) {
                let data: Buffer
                ({ type, size, data } = await image.getResized(width, restricted))
                const blob = new Blob([new Uint8Array(data)])
                stream = blob.stream()
                if (restricted)
                    action = ACTION_LOCKED
            } else {
                stream = streamFile(path)
            }
        }
    }

    after(() => {
        const meta = uaMeta(request.headers)
        image.getId().then(id => writeLog(id, action, ip, session?.user, meta))
    })

    return new Response(stream, {
        status: 200,
        headers: new Headers({
            'content-type': 'image/' + type,
            'content-length': size + ''
        })
    })
}
