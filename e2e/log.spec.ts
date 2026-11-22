import { expect, test } from '@playwright/test'

import { GEORGIA, db, imageId } from './helpers'
import { maintainLog } from '../lib/log-retention'

/*
 * Retention of the access log, run directly against the test database with chosen dates: the app runs the same
 * maintenance at start and once a day (instrumentation.ts).
 */

const day = 24 * 60 * 60 * 1000

/** The monthly partition of `log` for a date */
function partition(date: Date) {
    return `log_${date.getUTCFullYear()}_${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

test.afterAll(async () => {
    // The maintenance uses the app's database connection
    await global.__postgresSqlClient?.end()
    global.__postgresSqlClient = undefined
})

test('access log keeps months ahead, and drops the months that ended more than the retention period ago', async ({}, testInfo) => {
    const ip = `10.9.${Math.floor(testInfo.workerIndex / 250)}.${testInfo.workerIndex % 250 + 1}`
    const image = await imageId(GEORGIA, 'IMG_0001.jpg')
    const now = new Date()
    const ago = (days: number) => new Date(now.getTime() - days * day)
    const [old, older, recent] = [ago(400), ago(500), ago(1)]
    const where = (ctime: Date) => db()<{ partition: string }[]>`SELECT tableoid::regclass::text AS partition FROM log WHERE ip = ${ip} AND ctime = ${ctime}`

    await db()`DELETE FROM log WHERE ip = ${ip}`
    try {
        // Rows of months without a partition go to the default one
        for (const ctime of [old, older, recent])
            await db()`INSERT INTO log (image, ip, status, ctime) VALUES (${image}, ${ip}, 3, ${ctime})`
        expect((await where(old))[0].partition).toBe('log_default')

        // As it ran 400 days ago: the partitions of that month and the next two are made, and take in their rows
        const then = await maintainLog(old, 365)
        expect(then?.created).toContain(partition(old))
        expect((await where(old))[0].partition).toBe(partition(old))

        // Today: the months ahead exist, the month of 400 days ago is dropped with its rows, and the default
        // partition loses rows older than a year
        const today = await maintainLog(now, 365)
        const partitions = (await db()<{ name: string }[]>`
          SELECT c.relname AS name FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
          WHERE i.inhparent = 'log'::regclass
        `).map(row => row.name)
        for (let offset = 0; offset <= 2; offset++)
            expect(partitions).toContain(partition(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1))))
        expect(today?.dropped).toContain(partition(old))
        expect(partitions).not.toContain(partition(old))
        expect(await where(old)).toEqual([])
        expect(await where(older)).toEqual([])
        expect(await where(recent)).toHaveLength(1)

        // Retention 0 keeps everything
        expect(await maintainLog(now, 0)).toEqual({ created: [], dropped: [], deleted: 0 })
    } finally {
        await db()`DELETE FROM log WHERE ip = ${ip}`
    }
})
