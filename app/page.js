import BundleList from '@/components/bundle/list'
import Gallery from '@/components/gallery'

export default function Page({ searchParams }) {
    console.log(searchParams)
    if (Object.keys(searchParams).length > 0)
        return <Gallery searchParams={searchParams} />
    else
        return <BundleList />
}
