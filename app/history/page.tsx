import { redirect } from 'next/navigation'

import HistoryDays, { historyFilters, historyQuery } from '@/components/history/days'
import MoreHistory from '@/components/history/more'

import { getLogUsers } from '@/lib/db'
import { getSession, isAdmin } from '@/auth'


export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Visitors by day, newest first. Shows the latest week of the log, older weeks are loaded on scrolling. */
export default async function History(props: PageProps<'/history'>) {
    const searchParams = await props.searchParams
    const session = await getSession()
    if (!isAdmin(session))
        redirect('/signin')

    const query = historyQuery(searchParams)
    const { users, next } = await getLogUsers(historyFilters(query))

    return (
        <>
            <HistoryDays users={users} query={query} />
            <MoreHistory next={next} query={query} />
        </>
    )
}
