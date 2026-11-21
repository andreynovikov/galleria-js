import { headers } from 'next/headers'

import { getRandomImages } from '@/lib/db'
import { thumbnailWidths } from '@/lib/image'
import { clientIp, uaMeta } from '@/lib/utils'

import { auth } from '@/auth'
import PhotoSwiper, { type SwiperPhoto } from './swiper'

const basePath = process.env.BASE_PATH ?? ''

export default async function Top() {
    const session = await auth()
    const header = await headers()
    const meta = uaMeta(header)
    const ip = clientIp(header)

    const images = await getRandomImages(20)

    if (!images.at(0)?.restricted) {
        const restricted = images.findIndex(image => image.restricted)
        if (restricted > 0)
            images.splice(0, 0, images.splice(restricted, 1)[0])
    }

    const sid = session?.user?.id ?? ''
    const sizes = Object.keys(thumbnailWidths)
    const maxHeight = Object.values(thumbnailWidths).at(-1) as number

    const photos: SwiperPhoto[] = images.map(image => (
        {
            id: image.id,
            src: `${basePath}${image.bundle}/${image.name}?format=thumbnail&size=${sizes.at(-1)}&constraint=vertical&sid=${sid}`,
            href: `${image.bundle}?opener=${image.id}`,
            title: image.name,
            height: maxHeight,
            width: Math.floor(image.width / image.height * maxHeight),
            restricted: image.restricted ?? false
        }
    ))

    return <PhotoSwiper photos={photos} ip={ip} user={session?.user} meta={meta} />
}
