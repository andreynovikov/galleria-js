import { Fragment } from 'react'
import { redirect } from 'next/navigation'
import Link from 'next/link'

import moment from 'moment'

import { getLogUsers } from '@/lib/db'
import { auth } from '@/auth'

const adminIds = process.env.ADMIN_ID?.split(',') ?? []

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function History(props) {
    const searchParams = await props.searchParams
    const session = await auth()
    if (!session.user || !adminIds.includes(session.user.id))
        redirect('/api/auth/signin')

    const filters = {
        from: moment(searchParams['-filt.from'] ?? moment().subtract(3, 'months')),
        label: searchParams['-filt.label'],
        status: searchParams['-filt.status']
    }
    const users = await getLogUsers(filters)

    const days = users.reduce((days, user) => {
        const last = days.at(-1)
        const day = moment(user.day)
        user.meta = user.meta.filter(meta => (
            meta.browser || meta.ua || meta.device
        ))
        if (!last?.day.isSame(day, 'day')) {
            days.push({
                day,
                users: [user]
            })
        } else {
            last.users.push(user)
        }
        return days
    }, [])

    return days.map(day => (
        <div className="users" key={day.day}>
            <div className="date">
                {day.day.format('LL')}
            </div>
            <div>
                {day.users.map(user => (
                    <div key={user.id}>
                        <Link href={{
                            pathname: `/history/${user.id}/${day.day.format('YYYY-MM-DD')}`,
                            query: searchParams
                        }}>
                            {user.id}
                        </Link>
                        &nbsp;
                        ({user.count})
                        &nbsp;
                        <span className="meta">
                            {user.meta.map((meta, index) => (
                                <Fragment key={index}>
                                    {index > 0 && ', '}
                                    {meta.browser.name ? <>
                                        {`${meta.browser.name}`}
                                        {meta.browser.major && meta.browser.type !== 'crawler' && `/${meta.browser.major}`}
                                    </> : meta.ua }
                                    {meta.browser.type && ` (${meta.browser.type})`}
                                    {(meta.device.vendor || meta.device.type) && ' on '}
                                    {meta.device.vendor && `${meta.device.vendor} ${meta.device.model}`}
                                    {meta.device.type && ` (${meta.device.type})`}
                                </Fragment>
                            ))}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    ))
}
