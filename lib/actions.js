'use server'

import Image from './image'
import { listRelatedLabels, writeLog } from './db'

export async function getImage(id) {
    const image = Image.fromId(id)
    await image.expand()
    return JSON.parse(JSON.stringify(image))
}

export async function getRelatedLabels(included, excluded) {
    return await listRelatedLabels(included, excluded)
}

export async function log(id, action, ip, user, meta) {
    await writeLog(id, action, ip, user, meta)
}