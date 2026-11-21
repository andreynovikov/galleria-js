import { readdir } from 'fs/promises'
import { extname, join } from 'path'

import Image from './image'
import { getBundleImages } from './db'

declare global {
    var __bundleSyncs: Map<string, Promise<void>> | undefined
}

/** Syncs in progress by bundle. Kept on `globalThis`, so every module instance in the server process shares it. */
const syncs = global.__bundleSyncs ??= new Map<string, Promise<void>>()

/**
 * Brings the database in line with the bundle directory: imports new `.jpg` files, deletes rows of removed ones,
 * and with `updateMetadata` re-reads metadata of all files. Rejects with `ENOENT` if the directory is missing.
 *
 * Only one sync per bundle runs at a time: a sync requested while another one runs shares it, and a metadata update
 * starts after it. The work can be interrupted at any point (each photo is imported in its own transaction), the
 * next sync continues where it stopped.
 */
export function syncBundle(bundle: string, updateMetadata = false): Promise<void> {
    const running = syncs.get(bundle)
    if (running !== undefined && !updateMetadata)
        return running
    const sync: Promise<void> = (running ?? Promise.resolve())
        .catch(() => {}) // the previous sync's error has been reported to its callers
        .then(() => runSync(bundle, updateMetadata))
        .finally(() => {
            if (syncs.get(bundle) === sync)
                syncs.delete(bundle)
        })
    syncs.set(bundle, sync)
    return sync
}

async function runSync(bundle: string, updateMetadata: boolean) {
    const files = new Set((await readdir(join(process.env.PHOTOS_FOLDER as string, bundle)))
        .filter(file => extname(file).toLowerCase() === '.jpg'))
    const images = await getBundleImages(bundle)
    const known = new Map(images.map(image => [image.name, image.id]))

    // Removed files first: deleting is quick, and the album shouldn't list photos that are gone
    for (const image of images)
        if (!files.has(image.name))
            await Image.fromId(image.id).delete()

    for (const name of [...files].sort()) {
        const id = known.get(name)
        if (id !== undefined && !updateMetadata)
            continue
        // A broken file must not stop the rest of the album from being imported
        try {
            if (id === undefined)
                await Image.create(bundle, name)
            else
                await Image.fromId(id).updateMetadata()
        } catch (e) {
            console.error(`Can not read ${bundle}/${name}:`, e)
        }
    }
}
