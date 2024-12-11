import moment from 'moment'
import { getLabelMaps } from '@/lib/db'

export async function getTitle(conditions, searchParams) {
    if (Object.keys(searchParams).length > 0) {
        let labels = searchParams['-filt.labels']
        if (labels !== undefined) {
            const labelIds = await getLabelMaps()
            const labelNames = Object.fromEntries(Object.entries(labelIds).map(([k, v]) => [v, k]))
            labels = labels.split(',').map(l => labelNames[l] ?? l)
            conditions.push(labels.length > 1 ? 'с тегами' : 'с тегом')
            conditions.push(labels.join(', '))
        }
        let from = searchParams['-filt.from']
        if (from !== undefined) {
            conditions.push('после')
            conditions.push(moment(from).format('LLL'))
        }
        let till = searchParams['-filt.till']
        if (till !== undefined) {
            conditions.push('до')
            conditions.push(moment(till).format('LLL'))
        }
    }
    return conditions.join(' ')
}
