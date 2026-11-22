import { Fragment } from 'react'
import Link from 'next/link'

import moment, { type Moment } from 'moment'

import type { LogFilters, LogUser } from '@/lib/db'
import { param, type SearchParams } from '@/lib/utils'

/** Query string keys of `/history` filters, kept in the links to a visitor's day */
const filterKeys = ['-filt.from', '-filt.label', '-filt.status'] as const

export type HistoryQuery = Partial<Record<typeof filterKeys[number], string>>

/** The `/history` filters of a query string, without anything else */
export function historyQuery(searchParams: SearchParams): HistoryQuery {
    const query: HistoryQuery = {}
    for (const key of filterKeys) {
        const value = param(searchParams, key)
        if (typeof value === 'string')
            query[key] = value
    }
    return query
}

/** Filters for the log query; malformed values are ignored instead of reaching SQL */
export function historyFilters(query: HistoryQuery): LogFilters {
    const filters: LogFilters = {}
    const from = query['-filt.from'] === undefined ? undefined : moment(query['-filt.from'], moment.ISO_8601, true)
    if (from?.isValid())
        filters.from = from.toDate()
    const label = Number(query['-filt.label'])
    if (Number.isInteger(label) && label > 0)
        filters.label = label
    const status = query['-filt.status'] === undefined ? NaN : Number(query['-filt.status'])
    if (Number.isInteger(status) && status >= 0)
        filters.status = status
    return filters
}

interface Day {
    day: Moment
    users: LogUser[]
}

/** Visitors of `/history` grouped by day, newest first */
export default function HistoryDays({ users, query }: { users: LogUser[], query: HistoryQuery }) {
    const days = users.reduce<Day[]>((days, user) => {
        const last = days.at(-1)
        const day = moment(user.day)
        user.meta = user.meta.filter(meta => meta.browser || meta.ua || meta.device)
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
        <div className="users" key={day.day.toISOString()}>
            <div className="date">
                {day.day.format('LL')}
            </div>
            <div>
                {day.users.map(user => (
                    <div key={user.ip}>
                        <Link href={{
                            pathname: `/history/${user.ip}/${day.day.format('YYYY-MM-DD')}`,
                            query
                        }}>
                            {user.ip}
                            {user.visitors.map((visitor, index) => (
                                <Fragment key={index}>
                                    {index == 0 ? ' - ' : ', '}
                                    {visitor.name || visitor.email}
                                </Fragment>
                            ))}
                        </Link>
                        &nbsp;
                        ({user.count})
                        &nbsp;
                        <span className="meta">
                            {user.meta.map((meta, index) => (
                                <Fragment key={index}>
                                    {index > 0 && ', '}
                                    {meta.browser?.name ? <>
                                        {`${meta.browser.name}`}
                                        {meta.browser.major && meta.browser.type !== 'crawler' && `/${meta.browser.major}`}
                                    </> : meta.ua}
                                    {meta.browser?.type && ` (${meta.browser.type})`}
                                    {(meta.device?.vendor || meta.device?.type) && ' on '}
                                    {meta.device?.vendor && `${meta.device.vendor} ${meta.device.model}`}
                                    {meta.device?.type && ` (${meta.device.type})`}
                                </Fragment>
                            ))}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    ))
}
