'use server'

/*
 * Server actions are public endpoints: anyone can call them with any arguments, so they check access themselves and
 * validate what they get.
 */

import HistoryDays, { historyFilters, historyQuery } from '@/components/history/days'

import { getLogUsers } from '@/lib/db'
import type { SearchParams } from '@/lib/utils'
import { getSession, isAdmin } from '@/auth'

/**
 * The next page of `/history`, rendered on the server, and the `before` of the page after it. Returns `null` to
 * visitors who are not admins.
 */
export async function loadHistory(before: string, query: SearchParams) {
    if (!isAdmin(await getSession()))
        return null
    if (typeof before !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(before) || Number.isNaN(Date.parse(before)))
        return null
    const filters = historyQuery(query !== null && typeof query === 'object' ? query : {})
    const { users, next } = await getLogUsers(historyFilters(filters), before)
    return { content: <HistoryDays users={users} query={filters} />, next }
}
