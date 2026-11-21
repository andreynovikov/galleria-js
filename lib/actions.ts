'use server'

/*
 * Server actions are public endpoints: anyone can call them with any arguments, so they take only ids and values
 * chosen by the visitor, check access themselves, and read the session, IP and browser from the request.
 */

import { headers } from 'next/headers'

import postgres from 'postgres'

import { censorshipLevel, getSession } from '@/auth'

import Image, { ImageNotFoundError, type ImageInfo } from './image'
import { getRestrictedLabels, listRelatedLabels, writeLog, type LogMeta } from './db'
import { clientIp, uaMeta, ACTION_INFO, ACTION_ZOOM } from './utils'

/** More labels than anyone selects in the label cloud, each one adds a term to the query */
const maxLabels = 20

function isId(value: unknown): value is number {
    return Number.isInteger(value) && (value as number) > 0
}

function ids(values: unknown) {
    return Array.isArray(values) ? values.filter(isId).slice(0, maxLabels) : []
}

/**
 * Description of a photo for the lightbox. Photos the visitor is not allowed to see (censored above their level,
 * restricted for anonymous visitors) and missing ones get an empty description, so their existence isn't revealed.
 */
export async function getImage(id: number): Promise<ImageInfo> {
    if (!isId(id))
        return { id }
    const image = Image.fromId(id)
    try {
        await image.fetchData()
    } catch (e) {
        if (e instanceof ImageNotFoundError)
            return { id }
        throw e
    }
    const session = await getSession()
    if ((image.censored ?? 0) > censorshipLevel(session))
        return { id }
    if (!session) {
        const restricted = await getRestrictedLabels()
        const labels = await image.fetchLabels()
        if (labels.some(label => restricted.includes(label.id)))
            return { id }
    }
    await image.expand()
    const { FocalLength, ISO, ExposureTime, FNumber } = image.info ?? {}
    return {
        id,
        description: image.description,
        labels: image.labels,
        info: { FocalLength, ISO, ExposureTime, FNumber }
    }
}

export async function getRelatedLabels(included: number[], excluded: number[]) {
    return await listRelatedLabels(ids(included), ids(excluded))
}

async function log(id: number, action: number, extra: LogMeta = {}) {
    if (!isId(id))
        return
    const header = await headers()
    const session = await getSession()
    try {
        await writeLog(id, action, clientIp(header), session?.user, { ...uaMeta(header), ...extra })
    } catch (e) {
        // The photo may have been deleted by album sync while the page was open
        if (e instanceof postgres.PostgresError && e.code === '23503')
            return
        throw e
    }
}

/** Logs that a photo was opened in the lightbox */
export async function logView(id: number) {
    await log(id, ACTION_INFO)
}

/** Logs that a photo was zoomed in the lightbox */
export async function logZoom(id: number, zoom: number) {
    if (typeof zoom !== 'number' || !Number.isFinite(zoom) || zoom < 1 || zoom > 100)
        return
    await log(id, ACTION_ZOOM, { zoom: Math.round(zoom * 100) / 100 })
}
