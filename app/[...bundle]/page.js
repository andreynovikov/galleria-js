import { notFound } from 'next/navigation'

import Gallery from '@/components/gallery'

import { getTitle } from '@/lib/meta'

export default async function PhotosList(props) {
    const params = await props.params
    const searchParams = await props.searchParams
    if (params.bundle.at(-1) === 'thumbs')
        notFound()

    return <Gallery bundle={'/' + params.bundle.join('/')} searchParams={searchParams} />
}

export async function generateMetadata(props) {
    const params = await props.params
    const searchParams = await props.searchParams

    return {
        title: await getTitle(['Фотографии', 'из', params.bundle.join('/')], searchParams)
    }
}
