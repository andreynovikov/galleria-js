import { UAParser } from 'ua-parser-js'
import { Crawlers, Fetchers } from 'ua-parser-js/extensions'

export const ACTION_ORIGINAL = 0
export const ACTION_DOWNLOAD = 1
export const ACTION_ZOOM = 2
export const ACTION_VIEW = 3
export const ACTION_INFO = 4
export const ACTION_EXPORT = 5
export const ACTION_THUMBNAIL = 6
export const ACTION_LOCKED = 7

export function bool(value) {
    return value === true || +value > 0 || String(value).toLowerCase().trim() in ['true', '1', 'yes']
}

export function uaMeta(headers) {
    const meta = UAParser([Crawlers, Fetchers], headers).withClientHints()
    delete meta['cpu']
    if (meta.browser.name)
        delete meta['ua']
    return meta
}
