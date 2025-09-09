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

    const images = await getRandomImages(20)

    if (!images.at(0)?.restricted) {
        const restricted = images.findIndex(image => image.restricted)
        if (restricted)
            images.splice(0, 0, images.splice(restricted, 1)[0])
    }

    const photos = images.map(image => (
        {
            id: image.id,
            src: `${basePath}${image.bundle}/${image.name}?format=thumbnail&size=${Object.keys(thumbnailWidths).at(-1)}&constraint=vertical&sid=${session?.user.id ?? ''}`,
            href: `${image.bundle}?opener=${image.id}`,
            title: image.name,
            height: Object.values(thumbnailWidths).at(-1),
            width: Math.floor(image.width / image.height * Object.values(thumbnailWidths).at(-1)),
            restricted: image.restricted ?? false,
            srcSet: Object.entries(thumbnailWidths).map(([size, width]) => ({
                src: `${basePath}${image.bundle}/${image.name}?format=thumbnail&size=${size}&constraint=vertical&sid=${session?.user.id ?? ''}`,
                height: width,
                width: Math.round((image.width / image.height) * width)
            }))
        }
    ))

    return <PhotoSwiper photos={photos} ip={ip} user={session?.user} meta={JSON.parse(JSON.stringify(meta))} />
}
