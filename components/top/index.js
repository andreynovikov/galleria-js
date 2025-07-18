import { headers } from 'next/headers'

import { getRandomImages } from '@/lib/db'
import { thumbnailWidths } from '@/lib/image'
import { uaMeta } from '@/lib/utils'

import { auth } from '@/auth'
import PhotoSwiper from './swiper'

const basePath = process.env.BASE_PATH ?? ''

export default async function Top() {
    const session = await auth()
    const header = await headers()
    const meta = await uaMeta(header)
    const ip = (header.get('x-real-ip') ?? header.get('x-forwarded-for') ?? '127.0.0.1').split(',')[0]

    const images = await getRandomImages(45)

    const photos = images.map(image => (
        {
            id: image.id,
            src: `${basePath}${image.bundle}/${image.name}`,
            href: `${image.bundle}?opener=${image.id}`,
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

    return <PhotoSwiper photos={photos} ip={ip} user={session?.user} meta={JSON.parse(JSON.stringify(meta))} />
}
