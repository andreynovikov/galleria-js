import { getRandomImages } from '@/lib/db'
import { thumbnailWidths } from '@/lib/image'
import { urlPath } from '@/lib/utils'

import { censorshipLevel, getSession } from '@/auth'
import PhotoSwiper, { type SwiperPhoto } from './swiper'

const basePath = process.env.BASE_PATH ?? ''

export default async function Top() {
    const session = await getSession()

    const images = await getRandomImages(20, censorshipLevel(session))

    const sizes = Object.keys(thumbnailWidths)
    const maxHeight = Object.values(thumbnailWidths).at(-1) as number

    const photos: SwiperPhoto[] = images.map(image => (
        {
            id: image.id,
            src: `${basePath}${urlPath(`${image.bundle}/${image.name}`)}?format=thumbnail&size=${sizes.at(-1)}&constraint=vertical`,
            href: `${urlPath(image.bundle)}?opener=${image.id}`,
            title: image.name,
            height: maxHeight,
            width: Math.floor(image.width / image.height * maxHeight),
            restricted: image.restricted ?? false
        }
    ))

    return <PhotoSwiper photos={photos} />
}
