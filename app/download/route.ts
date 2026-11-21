import type { NextRequest } from 'next/server'

import { ZipArchive } from 'archiver'

import Image, { ImageNotFoundError, downloadMaxImages } from '@/lib/image'
import { writeLog } from '@/lib/db'
import { clientIp, uaMeta, ACTION_DOWNLOAD } from '@/lib/utils'
import { censorshipLevel, getSession } from '@/auth'

const basePath = process.env.BASE_PATH ?? ''
const screenMaxWidth = Number(process.env.SCREEN_MAX_WIDTH)

export async function GET(request: NextRequest) {
    const session = await getSession()

    if (!session?.user) {
        const callbackUrl = `${basePath}${request.nextUrl.pathname}${request.nextUrl.search}`
        return Response.redirect(new URL(`${basePath}/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`, request.nextUrl.origin), 307)
    }

    const user = session.user
    const level = censorshipLevel(session)
    const ip = clientIp(request.headers)
    const meta = uaMeta(request.headers)

    const ids = [...new Set((request.nextUrl.searchParams.get('images') ?? '').split(',').map(Number))]
        .filter(id => Number.isInteger(id) && id > 0)
    if (ids.length > downloadMaxImages)
        return new Response(`Too many photos, at most ${downloadMaxImages} can be downloaded at once`, {
            status: 400
        })
    const archive = new ZipArchive()

    const stream = new ReadableStream({
        async start(controller) {
            archive.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)))
            archive.on('end', () => controller.close())
            archive.on('error', (err: Error) => controller.error(err))

            for (const id of ids) {
                const image = Image.fromId(id)
                try {
                    await image.fetchData()
                } catch (e) {
                    if (e instanceof ImageNotFoundError)
                        continue
                    throw e
                }
                // Censored photos are skipped the same way as missing ones
                if ((image.censored ?? 0) > level)
                    continue

                let width = screenMaxWidth
                if (image.width !== undefined && image.height !== undefined && image.width < image.height)
                    width = Math.round(image.width / image.height * width)
                const resized = await image.getResized(width)
                archive.append(resized.data, { name: image.name as string })
                writeLog(id, ACTION_DOWNLOAD, ip, user, meta)
            }
            archive.finalize()
        },
    })

    const filename = 'images.zip'

    return new Response(stream, {
        status: 200,
        headers: new Headers({
            'content-disposition': `attachment; filename=${filename}`,
            'content-type': 'application/zip'
        })
    })
}
