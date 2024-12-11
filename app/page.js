import Gallery from '@/components/gallery'
import Selector from '@/components/selector'

import { getTitle } from '@/lib/meta'

export default async function Page(props) {
    const searchParams = await props.searchParams
    if (Object.keys(searchParams).length > 0)
        return <Gallery searchParams={searchParams} />
    else
        return <Selector />
}

export async function generateMetadata(props) {
    const searchParams = await props.searchParams

    if (Object.keys(searchParams).length > 0)
        return {
            title: await getTitle(['Фотографии'], searchParams)
        }
    else
        return {
            title: 'Альбомы и теги'
        }
}
