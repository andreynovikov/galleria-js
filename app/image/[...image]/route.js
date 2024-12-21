import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { join } from 'path'

import { after } from 'next/server'

import { auth } from '@/auth'

import Image from '@/lib/image'
import { writeLog } from '@/lib/db'
import { uaMeta, ACTION_ORIGINAL, ACTION_VIEW, ACTION_EXPORT, ACTION_THUMBNAIL } from '@/lib/utils'

const screenMaxWidth = Number(process.env.SCREEN_MAX_WIDTH)
const exportMaxWidth = Number(process.env.EXPORT_MAX_WIDTH)
const screenDelta = Number(process.env.SCREEN_DELTA)

/*
 * https://www.ericburel.tech/blog/nextjs-stream-files#moving-to-route-handlers-its-not-that-easy
 */

async function* nodeStreamToIterator(stream) {
    for await (const chunk of stream) {
        yield new Uint8Array(chunk)
    }
}

function streamFile(path) {
    const nodeStream = createReadStream(path)
    return ReadableStream.from(nodeStreamToIterator(nodeStream))
}

export async function GET(request, segmentData) {
    const params = await segmentData.params
    const session = await auth()
    const user = session?.user ?? {}
    user.ip = (request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for') ?? '127.0.0.1').split(',')[0]
    const format = request.nextUrl.searchParams.get('format')
    const ratio = +request.nextUrl.searchParams.get('ratio') || 1.0
    const thumbnailSize = request.nextUrl.searchParams.get('size') || 'm'
    const force = request.nextUrl.searchParams.get('force')
    const image = Image.fromPath(request.nextUrl.pathname)
    const fileName = params.image.at(-1)
    let path
    let stream
    let size
    let type
    let action

    if (format === 'thumbnail') {
        ({ type, size, path } = await image.makeThumbnail(thumbnailSize, force))
        stream = streamFile(path)
        action = ACTION_THUMBNAIL
    } else {
        path = join(process.env.PHOTOS_FOLDER, request.nextUrl.pathname)
        try {
            const stats = await stat(path)
            size = stats.size
            type = 'jpeg'
        } catch (e) {
            if (e?.code === 'ENOENT') {
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
        if (format === 'original') {
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

            if (ratio < 1)
                width = Math.round(width * ratio)
            if (image.width < image.height)
                width = Math.round(image.width / image.height * width)
            if (image.width > width * screenDelta) {
                let data
                ({ type, size, data } = await image.getResized(width))
                const blob = new Blob([data])
                stream = blob.stream()
            } else {
                stream = streamFile(path)
            }
        }
    }

    after(() => {
        const meta = uaMeta(request.headers)
        image.fetchData().then(() => writeLog(image.id, action, user, meta))
    })

    return new Response(stream, {
        status: 200,
        headers: new Headers({
            /*
            "content-disposition":
                `attachment; filename=${path.basename(
                    filePath
                )}`,
            */
            'content-type': 'image/' + type,
            'content-length': size + ''
        })
    })
}
