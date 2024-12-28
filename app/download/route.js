import { redirect } from 'next/navigation'

import archiver from 'archiver'

import Image from '@/lib/image'
import { writeLog } from '@/lib/db'
import { uaMeta, ACTION_DOWNLOAD } from '@/lib/utils'
import { auth } from '@/auth'

const screenMaxWidth = Number(process.env.SCREEN_MAX_WIDTH)

export async function GET(request) {
    const session = await auth()

    if (!session.user)
        redirect('/api/auth/signin')

    const ip = (request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for') ?? '127.0.0.1').split(',')[0]
    const meta = uaMeta(request.headers)

    const ids = (request.nextUrl.searchParams.get('images') ?? '').split(',')
    const archive = archiver('zip')

    const stream = new ReadableStream({
        async start(controller) {
            archive.on('data', chunk => controller.enqueue(chunk))
            archive.on('end', () => controller.close())
            archive.on('error', err => controller.error(err))

            for (const id of ids) {
                const image = Image.fromId(id)
                await image.fetchData()

                let width = screenMaxWidth
                if (image.width < image.height)
                    width = Math.round(image.width / image.height * width)
                const resized = await image.getResized(width)
                archive.append(resized.data, { name: image.name })
                writeLog(id, ACTION_DOWNLOAD, ip, session?.user, meta)
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
