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
        user: decodeURIComponent(params.user),
        label: searchParams['-filt.label'],
        status: searchParams['-filt.status']
    }
    if (params.day)
        filters.day = decodeURIComponent(params.day)
    const images = await getUserLog(filters)

    const days = images.reduce((days, image) => {
        const last = days.at(-1)
        const day = moment(image.day ?? params.day)
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
                {filters.user}
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
                                    style={{ aspectRatio: image.width / image.height }} />
                            </a>

                        ))}
                    </div>
                </div>
            ))}
        </>
    )
}
