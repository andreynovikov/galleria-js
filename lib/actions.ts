'use server'

import { censorshipLevel, getSession } from '@/auth'

import Image, { type ImageInfo } from './image'
import { listRelatedLabels, writeLog, type LogMeta, type VisitorRef } from './db'

export async function getImage(id: number): Promise<ImageInfo> {
    const image = Image.fromId(id)
    await image.fetchData()
    // Censored photos get an empty description, the same as photos without metadata
    if ((image.censored ?? 0) > censorshipLevel(await getSession()))
        return { id }
    await image.expand()
    return JSON.parse(JSON.stringify(image))
}

export async function getRelatedLabels(included: number[], excluded: number[]) {
    return await listRelatedLabels(included, excluded)
}

export async function log(id: number, action: number, ip: string, user: VisitorRef | undefined, meta: LogMeta) {
    await writeLog(id, action, ip, user, meta)
}
