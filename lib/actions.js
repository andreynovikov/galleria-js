'use server'

import Image from './image'
import { writeLog } from './db'

export async function getImage(id) {
    const image = Image.fromId(id)
    await image.expand()
    return JSON.parse(JSON.stringify(image))
}

export async function log(id, action, user) {
    await writeLog(id, action, user)
}