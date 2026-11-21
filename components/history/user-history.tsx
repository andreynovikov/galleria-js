import { Fragment } from 'react'
import { redirect } from 'next/navigation'
import moment, { type Moment } from 'moment'

import { getUserLog, type UserLogFilters, type UserLogImage } from '@/lib/db'
import { param } from '@/lib/utils'
import { getSession, isAdmin } from '@/auth'

const basePath = process.env.BASE_PATH ?? ''

type HistoryImage = Omit<UserLogImage, 'meta'> & { meta: { zoom?: number } }

interface Profile {
    id: string | null
    provider: string | null
    name?: string
    email?: string
    image?: string
    [key: string]: unknown
}

interface Day {
    day: Moment
    visitors: Map<string, { profile: Profile, images: HistoryImage[] }>
}

export default async function UserHistory(props: PageProps<'/history/[ip]'> | PageProps<'/history/[ip]/[day]'>) {
    const params: { ip: string, day?: string } = await props.params
    const searchParams = await props.searchParams
    const session = await getSession()
    if (!isAdmin(session))
        redirect('/signin')

    const filters: UserLogFilters = {
        ip: decodeURIComponent(params.ip),
        label: param(searchParams, '-filt.label'),
        status: param(searchParams, '-filt.status')
    }
    if (params.day)
        filters.day = decodeURIComponent(params.day)
    const images = await getUserLog(filters)

    const days = images.reduce<Day[]>((days, logImage) => {
        const lastDay = days.at(-1)
        const day = moment(logImage.day ?? params.day)
        const image: HistoryImage = {
            ...logImage,
            meta: logImage.meta.reduce<{ zoom?: number }>((meta, item) => {
                if (item?.zoom) {
                    meta.zoom = Math.max(item.zoom, meta.zoom ?? 1)
                }
                return meta
            }, {})
        }
        const visitorKey = `${image.visitor_id}@${image.visitor_provider}`
        const profile: Profile = {
            id: image.visitor_id,
            provider: image.visitor_provider,
            ...image.visitor
        }
        if (!lastDay?.day.isSame(day, 'day')) {
            days.push({
                day,
                visitors: new Map([[visitorKey, {
                    profile,
                    images: [image]
                }]])
            })
        } else if (!lastDay.visitors.has(visitorKey)) {
            lastDay.visitors.set(visitorKey, {
                profile,
                images: [image]
            })
        } else {
            lastDay.visitors.get(visitorKey)?.images.push(image)
        }
        return days
    }, [])

    return (
        days.map(day => (
            <div key={day.day.toISOString()}>
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
                                        {Object.entries(visitor.profile).filter(([k]) => !['name', 'email', 'image'].includes(k)).map(([k, v]) => (
                                            <div className="profile" key={k}>{k}: {String(v)}</div>
                                        ))}
                                    </>
                                )}
                            </div>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {visitor.profile.image && <img src={visitor.profile.image} className="profileImage" alt={visitor.profile.name} />}
                        </h2>
                        <div className="images">
                            {visitor.images.map(image => (
                                <a href={`${basePath}${image.bundle}/${image.name}`} className={`status${image.status}`} key={image.id}>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        loading="lazy"
                                        decoding="async"
                                        src={`${basePath}${image.bundle}/${image.name}?format=thumbnail&size=s`}
                                        alt={`${image.bundle}/${image.name}`}
                                        title={image.meta.zoom?.toString()}
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
