import type { Dirent, Stats } from 'fs'
import { readdir, realpath, stat } from 'fs/promises'
import { extname, join } from 'path'

import Image, { fileVersion } from './image'
import { deleteBundleImages, getBundleImages, listBundlePaths } from './db'

declare global {
    var __bundleSyncs: Map<string, Promise<void>> | undefined
    var __bundleSynced: Map<string, { at: number, folderModified: number }> | undefined
    var __photoScan: ReturnType<typeof setInterval> | undefined
}

/** Syncs in progress by bundle. Kept on `globalThis`, so every module instance in the server process shares it. */
const syncs = global.__bundleSyncs ??= new Map<string, Promise<void>>()
/** When each bundle was last synced, and the modification time its folder had then */
const synced = global.__bundleSynced ??= new Map<string, { at: number, folderModified: number }>()

/** A file modified more recently may still be being copied in: it is left for a later sync */
const settleTime = 60 * 1000
/** An album page syncs its folder when the folder changed, or when the last sync is older than this */
const viewSyncInterval = 60 * 1000
/** How often the whole photos folder is scanned (`SYNC_INTERVAL_MINUTES`), 0 for never */
const scanInterval = Math.max(Number(process.env.SYNC_INTERVAL_MINUTES ?? 10) || 0, 0) * 60 * 1000

const photosFolder = () => process.env.PHOTOS_FOLDER as string

function isPhoto(name: string) {
    return extname(name).toLowerCase() === '.jpg'
}

/**
 * Brings the database in line with the bundle directory: imports new `.jpg` files, re-reads the metadata of changed
 * ones (by size and modification time), and deletes rows of removed ones. Files modified within the last minute are
 * left for a later sync, because they may still be being copied. With `updateMetadata`, metadata of all files is
 * re-read. Rejects with `ENOENT` if the directory is missing.
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

/**
 * Sync for an album page view. It costs a `stat` of the folder when nothing can have changed: the folder is the same
 * as at the last sync (adding, removing or renaming a file changes its modification time) and that sync was less
 * than a minute ago. Files changed in place are picked up after that minute, or by the periodic scan.
 */
export async function syncBundleOnView(bundle: string, updateMetadata = false) {
    if (!updateMetadata) {
        // Rejects with ENOENT for a missing folder, as a sync would
        const folder = await stat(join(photosFolder(), bundle))
        const last = synced.get(bundle)
        if (folder.isDirectory() && last !== undefined && last.folderModified === folder.mtimeMs && Date.now() - last.at < viewSyncInterval)
            return
    }
    await syncBundle(bundle, updateMetadata)
}

/** Photo files of a folder with their stats; symbolic links to files count too */
async function photoFiles(folder: string, entries: Dirent[]) {
    const files = new Map<string, Stats>()
    for (const entry of entries) {
        if (!isPhoto(entry.name) || !(entry.isFile() || entry.isSymbolicLink()))
            continue
        try {
            const stats = await stat(join(folder, entry.name))
            if (stats.isFile())
                files.set(entry.name, stats)
        } catch (e) {
            // Removed meanwhile, or a broken link
            if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT')
                throw e
        }
    }
    return files
}

async function runSync(bundle: string, updateMetadata: boolean) {
    const started = Date.now()
    const folder = join(photosFolder(), bundle)
    // Taken before listing, so a file added meanwhile makes the next view sync again
    const folderModified = (await stat(folder)).mtimeMs
    const files = await photoFiles(folder, await readdir(folder, { withFileTypes: true }))
    const images = await getBundleImages(bundle)
    const known = new Map(images.map(image => [image.name, image]))

    // Removed files first: deleting is quick, and the album shouldn't list photos that are gone
    for (const image of images)
        if (!files.has(image.name))
            await Image.fromId(image.id).delete()

    const settled = started - settleTime
    for (const name of [...files.keys()].sort()) {
        const stats = files.get(name) as Stats
        if (stats.mtimeMs > settled)
            continue
        const version = fileVersion(stats)
        const image = known.get(name)
        // A broken file must not stop the rest of the album from being imported
        try {
            if (image === undefined) {
                await Image.create(bundle, name, version)
            } else if (image.size === null || image.mtime === null) {
                // Imported before versions were recorded: assumed unchanged, so an upgrade doesn't re-read everything
                if (updateMetadata)
                    await Image.fromId(image.id).updateMetadata(version)
                else
                    await Image.fromId(image.id).recordVersion(version)
            } else if (image.size !== version.size || image.mtime.getTime() !== version.mtime.getTime()) {
                // The file was replaced or edited: its thumbnails show the old one
                const photo = Image.fromId(image.id)
                await photo.deleteThumbnails()
                await photo.updateMetadata(version)
            } else if (updateMetadata) {
                await Image.fromId(image.id).updateMetadata(version)
            }
        } catch (e) {
            console.error(`Can not read ${bundle}/${name}:`, e)
        }
    }
    synced.set(bundle, { at: started, folderModified })
}

/** Whether a directory entry is a folder, following symbolic links */
async function isFolder(path: string, entry: Dirent) {
    if (entry.isDirectory())
        return true
    if (!entry.isSymbolicLink())
        return false
    try {
        return (await stat(path)).isDirectory()
    } catch {
        return false
    }
}

/**
 * Syncs every album at `under` (a bundle path, `''` for the whole photos folder) and below it, so new albums appear
 * without anyone opening them, and deletes the photos of album folders that are gone. Hidden folders and `thumbs` are
 * skipped, symbolic links are followed (once each). Albums are synced one after another.
 */
export async function scanPhotos(under = '') {
    const found: string[] = []
    const visited = new Set<string>()

    async function walk(bundle: string) {
        const folder = join(photosFolder(), bundle)
        const real = await realpath(folder)
        if (visited.has(real))
            return
        visited.add(real)
        let hasPhotos = false
        for (const entry of await readdir(folder, { withFileTypes: true })) {
            if (entry.name.startsWith('.') || entry.name === 'thumbs')
                continue
            if (await isFolder(join(folder, entry.name), entry))
                await walk(`${bundle}/${entry.name}`)
            else if (isPhoto(entry.name))
                hasPhotos = true
        }
        // Photos right in the photos folder have no album page
        if (hasPhotos && bundle !== '')
            found.push(bundle)
    }

    try {
        await walk(under)
    } catch (e) {
        // A missing photos folder (an unmounted disk, say) must not delete the whole archive
        console.error(`Can not scan ${under || 'the photos folder'}, nothing is synced:`, e)
        return { synced: 0, removed: 0 }
    }
    for (const bundle of found.sort()) {
        try {
            await syncBundle(bundle)
        } catch (e) {
            console.error(`Can not sync ${bundle}:`, e)
        }
    }

    let removed = 0
    if (found.length === 0) {
        console.warn(`No albums found in ${under || 'the photos folder'}: their photos are not removed from the database`)
    } else {
        const present = new Set(found)
        for (const bundle of await listBundlePaths(under)) {
            if (present.has(bundle))
                continue
            // A folder left without photos is synced as usual; one that is gone has its photos deleted
            try {
                await syncBundle(bundle)
            } catch (e) {
                if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') {
                    console.error(`Can not sync ${bundle}:`, e)
                    continue
                }
                await deleteBundleImages(bundle)
                synced.delete(bundle)
                removed++
            }
        }
    }
    return { synced: found.length, removed }
}

/** Scans the photos folder now and then every `SYNC_INTERVAL_MINUTES`; called once at server start */
export function schedulePhotoScan() {
    if (scanInterval === 0 || global.__photoScan !== undefined)
        return
    let running = false
    const run = async () => {
        if (running)
            return
        running = true
        try {
            await scanPhotos()
        } catch (e) {
            console.error('Photo scan failed:', e)
        } finally {
            running = false
        }
    }
    void run()
    global.__photoScan = setInterval(run, scanInterval)
    global.__photoScan.unref()
}
