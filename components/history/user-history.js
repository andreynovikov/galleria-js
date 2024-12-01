import { redirect } from 'next/navigation'
import moment from 'moment'

import { getUserLog } from '@/lib/db'
import { auth } from '@/auth'

const adminIds = process.env.ADMIN_ID?.split(',') ?? []
const basePath = process.env.BASE_PATH ?? ''

export default async function UserHistory(props) {
    const params = await props.params
    const searchParams = await props.searchParams
    const session = await auth()
    if (!session.user || !adminIds.includes(session.user.id))
        redirect('/api/auth/signin')

    const filters = {
        user: params.user && decodeURIComponent(params.user),
        ip: params.ip && decodeURIComponent(params.ip),
        label: searchParams['-filt.label'],
        status: searchParams['-filt.status']
    }
    if (params.day)
        filters.day = decodeURIComponent(params.day)
    const images = await getUserLog(filters)
    const visitor = images[0].visitor

    const days = images.reduce((days, image) => {
        const last = days.at(-1)
        const day = moment(image.day ?? params.day)
        image.meta = image.meta.reduce((meta, item) => {
            if (item?.zoom) {
                meta.zoom = Math.max(item.zoom, meta.zoom ?? 1)
            }
            return meta
        }, {})
        if (!last?.day.isSame(day, 'day')) {
            days.push({
                day,
                images: [image]
            })
        } else {
            last.images.push(image)
        }
        return days
    }, [])

    return (
        <>
            <h1>
                {visitor.name || visitor.email || visitor.ip}
                {visitor.id && Object.entries(visitor).map(([k, v]) => (
                    <div className="visitor" key={k}>{k}: {v}</div>
                ))}
            </h1>
            {days.map(day => (
                <div key={day.day}>
                    <div className="date">
                        {day.day.format('LL')}
                    </div>

                    <div className="images">
                        {day.images.map(image => (
                            <a href={`${basePath}${image.bundle}/${image.name}`} key={image.id}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    loading="lazy"
                                    decoding="async"
                                    src={`${basePath}${image.bundle}/${image.name}?format=thumbnail&size=s`}
                                    className={`status${image.status}`}
                                    alt={`${image.bundle}/${image.name}`}
                                    title={image.meta.zoom}
                                    style={{ aspectRatio: image.width / image.height }} />
                            </a>

                        ))}
                    </div>
                </div>
            ))}
        </>
    )
}
