'use server'

import Image from './image'

export async function getImage(id) {
    const image = Image.fromId(id)
    await image.expand()
    return JSON.parse(JSON.stringify(image))
}
