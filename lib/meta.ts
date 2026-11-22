import { getFormatter, getTranslations } from 'next-intl/server'

import { getLabelNames } from '@/lib/db'
import { param, parseDate, type SearchParams } from '@/lib/utils'

/**
 * Page title of a gallery: all photos, or the photos of `bundle`, followed by the filters of the query string. Each
 * filter is a phrase of its own in the messages, so languages can word them differently.
 */
export async function getTitle(searchParams: SearchParams, bundle?: string) {
    const t = await getTranslations('Titles')
    const format = await getFormatter()

    const parts = [bundle === undefined ? t('photos') : t('photosFrom', { album: bundle.slice(1) })]
    const labels = param(searchParams, '-filt.labels')
    if (labels !== undefined) {
        const values = labels.split(',')
        const labelNames = await getLabelNames(values.map(Number).filter(id => Number.isInteger(id) && id > 0))
        const names = values.map(l => labelNames[l] ?? l)
        parts.push(t('withLabels', { count: names.length, labels: names.join(', ') }))
    }
    // Read the way Gallery reads them, so the title shows the filter that is applied
    const from = parseDate(param(searchParams, '-filt.from'))
    if (from !== undefined)
        parts.push(t('after', { date: format.dateTime(from, { dateStyle: 'long', timeStyle: 'short' }) }))
    const till = parseDate(param(searchParams, '-filt.till'))
    if (till !== undefined)
        parts.push(t('before', { date: format.dateTime(till, { dateStyle: 'long', timeStyle: 'short' }) }))
    return parts.join(' ')
}
