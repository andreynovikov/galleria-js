
import Gallery from '@/components/gallery'
import Selector from '@/components/selector'

export default function Page({ searchParams }) {
    if (Object.keys(searchParams).length > 0)
        return <Gallery searchParams={searchParams} />
    else
        return <Selector />
}
