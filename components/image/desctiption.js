import { useState, useEffect } from 'react'

import { getImage } from '@/lib/actions'

function Loading() {
    return <>Loading...</>
}

export default function ImageDescription({ id, ...props }) {
    const [image, setImage] = useState({})

    useEffect(() => {
        getImage(id).then(data => setImage(data))
    }, [])

    const exif = []
    if ('info' in image) {
        if ('FocalLength' in image.info) {
            exif.push(image.info.FocalLength + 'mm')
        }
        if ('ISO' in image.info) {
            exif.push('ISO ' + image.info.ISO)
        }
        if ('ExposureTime' in image.info) {
            if (image.info.ExposureTime < 1) {
                exif.push('1/' + Math.floor(1 / image.info.ExposureTime) + 's')
            } else {
                exif.push(image.info.ExposureTime + 's')
            }
        }
        if ('FNumber' in image.info) {
            exif.push('f/' + image.info.FNumber)
        }
    }

    return <div {...props}>
        {image?.id ? (
            <>
                <span className="name">{image.name}</span>
                {image.labels.length > 0 && (
                    <span className="labels">
                        {image.labels.map((label, index) => (
                            <>
                                {index > 0 && ', '}
                                <a href={`/?-filt.labels=${label.id}`} key={label.id}>{label.name}</a>
                            </>
                        ))}
                    </span>
                )}
                {exif.length > 0 && <span className="exif">{exif.join(', ')}</span>}
            </>
        ) : (
            <Loading />
        )}
    </div>
}
