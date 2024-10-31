import { readdir } from 'fs/promises'
import { extname, join } from 'path'

import Image from './image'
import { listImages, getBundleImages } from './db'

export async function getImages(filters, order) {
    const images = await listImages(filters, order)
    return images
}

export async function syncBundle(bundle, updateMetadata=false) {
    const path = join(process.env.PHOTOS_FOLDER, bundle)
    console.log(path)

    // List files in directory
    const files = await readdir(path)
    const imageFiles = files.filter(file => {
        return extname(file).toLowerCase() === '.jpg'
    })
    const items = imageFiles.reduce((items, file) => {
        items[file] = 2
        return items
    }, {})

    // Look what is already present in database
    const ids = {}
    const images = await getBundleImages(bundle)
    for (const image of images) {
        if (!(image.name in items))
            items[image.name] = 0
        if (items[image.name] === 3) {
            // Remove duplicates                                                                                                                                     
            //im = GalleriaImage.fromid(image['id'])
            //im.delete(keep_file=True)
            continue
        }
        items[image.name] += 1
        ids[image.name] = image.id
    }

    // Analyze what was found
    for (const name of Object.keys(items).sort()) {
        // Image is in the directory but not in database
        if (items[name] === 2)
            await Image.create(bundle, name)
        // Image is in the database but not in the directory
        else if (items[name] === 1) {
            const image = Image.fromId(ids[name])
            await image.delete()
        // Image is in sync, update metadata if requested
        } else if (updateMetadata) {
            const image = Image.fromId(ids[name])
            await image.updateMetadata()
        }
    }
}
