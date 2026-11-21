import { UAParser, type IResult, type UAParserExt, type UAParserHeaders } from 'ua-parser-js'
import { Crawlers, Fetchers } from 'ua-parser-js/extensions'

import type { LogMeta } from './db'

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

export function bool(value: unknown) {
    return value === true || Number(value) > 0 || ['true', '1', 'yes'].includes(String(value).toLowerCase().trim())
}

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
