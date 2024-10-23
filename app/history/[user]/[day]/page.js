import { getUserLog } from '@/lib/db'

import { thumbnailWidths } from '@/lib/image'

const statusColors = {
    0: '#faa',
    1: '#b66',
    2: '#afa',
    4: '#6a6',
    5: '#aaf'
}

const basePath = process.env.BASE_PATH ?? ''

export default async function History({ params }) {
    const filters = {
        user: decodeURIComponent(params.user),
        day: decodeURIComponent(params.day)
    }
    const images = await getUserLog(filters)

    //{% set height = config.THUMBNAIL_WIDTH.s / image.width * image.height %}

    return (
        <>
            <h1>
                {filters.user}
            </h1>
            <div>
                {images.map(image => (
                    <a href={`${basePath}${image.bundle}/${image.name}`} key={image.id}>
                        <img
                            loading="lazy"
                            decoding="async"
                            src={`${basePath}${image.bundle}/${image.name}?format=thumbnail&size=s`}
                            style={{
                                height: thumbnailWidths['s'],
                                width: thumbnailWidths['s'] * image.width / image.height,
                                margin: '3px',
                                borderWidth: '3px',
                                borderStyle: 'solid',
                                borderColor: statusColors[image.status] || '#ccc'
                            }} />
                    </a>

                ))}
            </div>
        </>
    )
}
