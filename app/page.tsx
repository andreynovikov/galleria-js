import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'

import Gallery from '@/components/gallery'
import Selector from '@/components/selector'
import Top from '@/components/top'

import { getTitle } from '@/lib/meta'

export default async function Page(props: PageProps<'/'>) {
    const searchParams = await props.searchParams
    if (Object.keys(searchParams).length > 0)
        return <Gallery searchParams={searchParams} />
    else
        return (
            <>
                <Top />
                <Selector />
            </>
        )
}

export async function generateMetadata(props: PageProps<'/'>): Promise<Metadata> {
    const searchParams = await props.searchParams

    if (Object.keys(searchParams).length > 0)
        return {
            title: await getTitle(searchParams)
        }
    else
        return {
            title: (await getTranslations('Titles'))('albumsAndLabels')
        }
}
