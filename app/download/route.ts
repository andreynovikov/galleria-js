import { redirect } from 'next/navigation'
import type { NextRequest } from 'next/server'

import { ZipArchive } from 'archiver'

import Image from '@/lib/image'
import { writeLog } from '@/lib/db'
import { clientIp, uaMeta, ACTION_DOWNLOAD } from '@/lib/utils'
import { getSession } from '@/auth'

const screenMaxWidth = Number(process.env.SCREEN_MAX_WIDTH)

export async function GET(request: NextRequest) {
    const session = await getSession()

    if (!session?.user)
        redirect('/signin')

    const user = session.user
    const ip = clientIp(request.headers)
    const meta = uaMeta(request.headers)

    const ids = (request.nextUrl.searchParams.get('images') ?? '').split(',').map(Number).filter(id => id > 0)
    const archive = new ZipArchive()

    const stream = new ReadableStream({
        async start(controller) {
            archive.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)))
            archive.on('end', () => controller.close())
            archive.on('error', (err: Error) => controller.error(err))

            for (const id of ids) {
                const image = Image.fromId(id)
                await image.fetchData()

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
            'content-type': 'text/plain'
        })
    })
}
