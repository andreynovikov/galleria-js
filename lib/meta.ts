import moment from 'moment'
import { getLabelNames } from '@/lib/db'
import { param, type SearchParams } from '@/lib/utils'

export async function getTitle(conditions: string[], searchParams: SearchParams) {
    if (Object.keys(searchParams).length > 0) {
        const labels = param(searchParams, '-filt.labels')
        if (labels !== undefined) {
            const values = labels.split(',')
            const labelNames = await getLabelNames(values.map(Number).filter(id => Number.isInteger(id) && id > 0))
            const names = values.map(l => labelNames[l] ?? l)
            conditions.push(names.length > 1 ? 'с тегами' : 'с тегом')
            conditions.push(names.join(', '))
        }
        const from = param(searchParams, '-filt.from')
        if (from !== undefined) {
            conditions.push('после')
            conditions.push(moment(from).format('LLL'))
        }
        const till = param(searchParams, '-filt.till')
        if (till !== undefined) {
            conditions.push('до')
            conditions.push(moment(till).format('LLL'))
        }
    }
    return conditions.join(' ')
}
