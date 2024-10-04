import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { join } from 'path'

import Image from '@/lib/image'

/*
 * https://www.ericburel.tech/blog/nextjs-stream-files#moving-to-route-handlers-its-not-that-easy
 */

async function* nodeStreamToIterator(stream) {
    for await (const chunk of stream) {
        yield new Uint8Array(chunk)
    }
}

function iteratorToStream(iterator) {
    return new ReadableStream({
        async pull(controller) {
            const { value, done } = await iterator.next()
            if (done)
                controller.close()
            else
                controller.enqueue(value)
        }
    })
}

function streamFile(path) {
    const nodeStream = createReadStream(path)
    const data = iteratorToStream(
        nodeStreamToIterator(
            nodeStream
        )
    )
    return data
}

export async function GET(request, { params }) {
    const { format, ratio, size: thumbnailSize, force } = Object.fromEntries(request.nextUrl.searchParams)
    const image = Image.fromPath(request.nextUrl.pathname)
    const fileName = params.image.at(-1)
    let path
    let size
    let type

    if (format === 'thumbnail') {
        ({ type, size, path } = await image.makeThumbnail(thumbnailSize, force?.toLowerCase() === 'true'))
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

    }

    const stream = streamFile(path)

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
