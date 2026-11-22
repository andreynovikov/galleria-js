import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import Gallery from '@/components/gallery'

import { getTitle } from '@/lib/meta'
import { decodePath } from '@/lib/utils'

export default async function PhotosList(props: PageProps<'/[...bundle]'>) {
    const params = await props.params
    const searchParams = await props.searchParams
    // Next gives the segments percent-encoded
    const bundle = decodePath(params.bundle)
    if (bundle === null || params.bundle.at(-1) === 'thumbs')
        notFound()

    return <Gallery bundle={bundle} searchParams={searchParams} />
}

export async function generateMetadata(props: PageProps<'/[...bundle]'>): Promise<Metadata> {
    const params = await props.params
    const searchParams = await props.searchParams

    return {
        title: await getTitle(searchParams, decodePath(params.bundle) ?? '/')
    }
}
