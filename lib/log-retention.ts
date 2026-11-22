/*
 * Retention of the access log. `log` is partitioned by month: every day the app makes sure the partitions of this
 * month and the next two exist, drops the months that ended more than LOG_RETENTION_DAYS ago as a whole, and deletes
 * expired rows from the default partition (rows of months that had no partition when they were written). Dates are
 * UTC wall-clock time, like `log.ctime`.
 */
import { createLogPartition, deleteOldDefaultLog, dropLogPartition, isLogPartitioned, listLogPartitions } from './db'

/** Days the access log is kept; 0 keeps it forever */
export const logRetentionDays = Math.max(Number(process.env.LOG_RETENTION_DAYS ?? 365) || 0, 0)

/** Months ahead of the current one with a partition, so rows never wait for one */
const monthsAhead = 2

const day = 24 * 60 * 60 * 1000

function monthStart(year: number, month: number) {
    return new Date(Date.UTC(year, month, 1))
}

function isoDate(date: Date) {
    return date.toISOString().slice(0, 10)
}

function partitionName(start: Date) {
    return `log_${start.getUTCFullYear()}_${String(start.getUTCMonth() + 1).padStart(2, '0')}`
}

/** What one maintenance run did */
export interface LogMaintenance {
    created: string[]
    dropped: string[]
    deleted: number
}

/** Creates the coming partitions and removes the expired ones, as of `now` */
export async function maintainLog(now = new Date(), retentionDays = logRetentionDays): Promise<LogMaintenance | null> {
    if (!await isLogPartitioned()) {
        console.warn('The access log is not partitioned, so it is kept forever: apply sql/migrations/2026-11-22-log-partitions.sql')
        return null
    }
    const result: LogMaintenance = { created: [], dropped: [], deleted: 0 }
    const existing = new Set(await listLogPartitions())

    for (let offset = 0; offset <= monthsAhead; offset++) {
        const start = monthStart(now.getUTCFullYear(), now.getUTCMonth() + offset)
        const name = partitionName(start)
        if (!existing.has(name)) {
            await createLogPartition(name, isoDate(start), isoDate(monthStart(start.getUTCFullYear(), start.getUTCMonth() + 1)))
            result.created.push(name)
        }
    }

    if (retentionDays > 0) {
        const cutoff = new Date(now.getTime() - retentionDays * day)
        // A month goes once all of it is older than the cutoff, that is when it ended before
        for (const name of existing) {
            const [, year, month] = /^log_(\d{4})_(\d{2})$/.exec(name) as RegExpExecArray
            // The name has the month from 1, Date.UTC counts from 0: this is the start of the month after it
            const end = monthStart(Number(year), Number(month))
            if (end <= cutoff) {
                await dropLogPartition(name)
                result.dropped.push(name)
            }
        }
        result.deleted = await deleteOldDefaultLog(cutoff)
    }
    return result
}

declare global {
    var __logMaintenance: ReturnType<typeof setInterval> | undefined
}

/** Runs the maintenance now and then once a day; called once at server start (instrumentation.ts) */
export function scheduleLogMaintenance() {
    if (global.__logMaintenance !== undefined)
        return
    let running = false
    const run = async () => {
        if (running)
            return
        running = true
        try {
            const result = await maintainLog()
            if (result !== null && (result.created.length > 0 || result.dropped.length > 0 || result.deleted > 0))
                console.log('Access log maintenance:', JSON.stringify(result))
        } catch (e) {
            console.error('Access log maintenance failed, it is tried again tomorrow:', e)
        } finally {
            running = false
        }
    }
    void run()
    global.__logMaintenance = setInterval(run, day)
    global.__logMaintenance.unref()
}
