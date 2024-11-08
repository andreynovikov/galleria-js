import { notFound } from 'next/navigation'

import Gallery from '@/components/gallery'

export default async function PhotosList(props) {
    const params = await props.params
    const searchParams = await props.searchParams
    if (params.bundle.at(-1) === 'thumbs')
        notFound()

    return <Gallery bundle={'/' + params.bundle.join('/')} searchParams={searchParams} />
}