import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import Gallery from '@/components/gallery'

import { getTitle } from '@/lib/meta'

export default async function PhotosList(props: PageProps<'/[...bundle]'>) {
    const params = await props.params
    const searchParams = await props.searchParams
    if (params.bundle.at(-1) === 'thumbs')
        notFound()

    return <Gallery bundle={'/' + params.bundle.join('/')} searchParams={searchParams} />
}

export async function generateMetadata(props: PageProps<'/[...bundle]'>): Promise<Metadata> {
    const params = await props.params
    const searchParams = await props.searchParams

    return {
        title: await getTitle(['Фотографии', 'из', params.bundle.join('/')], searchParams)
    }
}
