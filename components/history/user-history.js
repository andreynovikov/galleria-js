import { Fragment } from 'react'
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
        ip: decodeURIComponent(params.ip),
        label: searchParams['-filt.label'],
        status: searchParams['-filt.status']
    }
    if (params.day)
        filters.day = decodeURIComponent(params.day)
    const images = await getUserLog(filters)

    const days = images.reduce((days, image) => {
        const lastDay = days.at(-1)
        const day = moment(image.day ?? params.day)
        image.meta = image.meta.reduce((meta, item) => {
            if (item?.zoom) {
                meta.zoom = Math.max(item.zoom, meta.zoom ?? 1)
            }
            return meta
        }, {})
        const visitorKey = `${image.visitor_id}@${image.visitor_provider}`
        const profile = {
            id: image.visitor_id,
            provider: image.visitor_provider,
            ...image.visitor
        }
        if (!lastDay?.day.isSame(day, 'day')) {
            days.push({
                day,
                visitors: new Map()
            })
            days.at(-1).visitors.set(visitorKey, {
                profile,
                images: [image]
            })
        } else if (!lastDay.visitors.has(visitorKey)) {
            lastDay.visitors.set(visitorKey, {
                profile,
                images: [image]
            })
        } else {
            lastDay.visitors.get(visitorKey).images.push(image)
        }
        return days
    }, [])

    return (
        days.map(day => (
            <div key={day.day}>
                <h1>
                    {day.day.format('LL')}
                </h1>

                {Array.from(day.visitors.entries()).map(([key, visitor]) => (
                    <Fragment key={key}>
                        <h2>
                            <div>
                                {visitor.profile.name || visitor.profile.email || filters.ip}
                                {visitor.profile.id && (
                                    <>
                                        {visitor.profile.name && visitor.profile.email && <div className="profile">email: {visitor.profile.email}</div>}
                                        {Object.entries(visitor.profile).filter(([k, v]) => !['name', 'email', 'image'].includes(k)).map(([k, v]) => (
                                            <div className="profile" key={k}>{k}: {v}</div>
                                        ))}
                                    </>
                                )}
                            </div>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {visitor.profile.image && <img src={visitor.profile.image} className="profileImage" />}
                        </h2>
                        <div className="images">
                            {visitor.images.map(image => (
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
                    </Fragment>
                ))}
            </div>
        ))
    )
}
