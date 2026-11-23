import { UAParser, type IResult, type UAParserExt, type UAParserHeaders } from 'ua-parser-js'
import { Crawlers, Fetchers } from 'ua-parser-js/extensions'

import type { LogMeta } from './db'

// Persisted in log.status; lower values take precedence when history groups a photo's actions with MIN(status).
// Keep existing numbers stable so old log rows retain their meaning.
export const ACTION_ORIGINAL = 0
export const ACTION_DOWNLOAD = 1
export const ACTION_ZOOM = 2
export const ACTION_VIEW = 3
export const ACTION_INFO = 4
export const ACTION_EXPORT = 5
export const ACTION_THUMBNAIL = 6
export const ACTION_LOCKED = 7

export type SearchParams = { [key: string]: string | string[] | undefined }

/** Returns the first value of a search parameter */
export function param(searchParams: SearchParams, key: string) {
    const value = searchParams[key]
    return Array.isArray(value) ? value[0] : value
}

/** Query string of the page, without `?` */
export function queryString(searchParams: SearchParams) {
    return Object.entries(searchParams).flatMap(([key, value]) => (
        ([] as string[]).concat(value ?? []).map(v => `${encodeURIComponent(key)}=${encodeURIComponent(v)}`)
    )).join('&')
}

/** URL path of an album or photo path, such as `/travel/Грузия/IMG 1.jpg`, with each segment percent-encoded */
export function urlPath(path: string) {
    return path.split('/').map(encodeURIComponent).join('/')
}

/**
 * Album or photo path from percent-encoded URL path segments. Returns `null` when a segment is malformed or would
 * leave its folder once decoded (an encoded `/`, `.` or `..`), so the path stays inside the photos folder.
 */
export function decodePath(segments: string[]) {
    const decoded: string[] = []
    for (const segment of segments) {
        let value: string
        try {
            value = decodeURIComponent(segment)
        } catch {
            return null
        }
        if (value === '' || value === '.' || value === '..' || value.includes('/') || value.includes('\0'))
            return null
        decoded.push(value)
    }
    return '/' + decoded.join('/')
}

/**
 * A date and time as written, in the form `2015-06-26`, `2015-06-26T10:00`, `2015-06-26 10:00:00.5` or EXIF's
 * `2015:06:26 10:00:00`, as the `Date` whose UTC fields are that time, `undefined` if it is not one. A zone after the
 * time (`Z`, `+03:00`, `UTC`) is ignored, as PostgreSQL ignores it for `timestamp` columns: those hold wall-clock
 * times, such as the shooting time from EXIF and the `-filt.from`/`-filt.till` filters on it, and pages format
 * dates in UTC (`i18n/request.ts`). So nothing depends on the time zone of the server.
 */
export function parseDate(value?: string) {
    const match = value?.trim().match(
        /^(\d{4})[-:](\d\d)[-:](\d\d)(?:[T ](\d\d):(\d\d)(?::(\d\d)(?:\.(\d+))?)?)?(?:\s*(?:Z|UTC|[+-]\d\d(?::?\d\d)?))?$/i)
    if (!match)
        return undefined
    const [year, month, day, hour, minute, second] = match.slice(1, 7).map(field => Number(field ?? 0))
    const ms = Number((match[7] ?? '').slice(0, 3).padEnd(3, '0'))
    const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms))
    date.setUTCFullYear(year) // Date.UTC() takes years below 100 as 19xx
    // Date.UTC() carries fields over (June 31 is July 1, EXIF's unset 0000:00:00 is in -1), they aren't dates
    const valid = date.getUTCMonth() === month - 1 && date.getUTCDate() === day && hour < 24 && minute < 60 && second < 60
    return valid ? date : undefined
}

export function bool(value: unknown) {
    return value === true || Number(value) > 0 || ['true', '1', 'yes'].includes(String(value).toLowerCase().trim())
}

/** Assumes the front-end proxy replaces client-supplied forwarding headers with trusted values. */
export function clientIp(headers: Headers) {
    return (headers.get('x-real-ip') ?? headers.get('x-forwarded-for') ?? '127.0.0.1').split(',')[0]
}

/** Parses user agent and client hints into a plain JSON object suitable for logging */
export function uaMeta(headers: UAParserHeaders): LogMeta {
    // Client hints are taken from headers synchronously, a promise is returned only in browser
    const result = UAParser([Crawlers, Fetchers] as UAParserExt, headers).withClientHints() as IResult
    const meta = JSON.parse(JSON.stringify(result))
    delete meta['cpu']
    if (meta.browser?.name)
        delete meta['ua']
    return meta
}
