import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { join } from 'path'

import Image from '@/lib/image'

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

export async function GET(request, { params }) {
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

    if (format === 'thumbnail') {
        ({ type, size, path } = await image.makeThumbnail(thumbnailSize, force))
        stream = streamFile(path)
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
        } else {
            await image.fetchData()

            let width = screenMaxWidth
        
            if (format === 'export') {
                width = exportMaxWidth
                // log(image.id, db.LOG_STATUS_EXPORT)
            } else {
                // log(image.id, db.LOG_STATUS_VIEW)
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
