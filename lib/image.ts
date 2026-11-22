import { randomUUID } from 'crypto'
import type { Stats } from 'fs'
import { mkdir, readdir, rename, rm, stat } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { Exifr } from 'exifr'
import sharp from 'sharp'
import { decode } from 'utf8'

import { getImageById, getImageByName, addImage, deleteImage, updateImage, getLabelIds, getImageLabels, setImageLabels } from './db'
import type { CameraSettings, ImageRecord, ImageUpdate, Label } from './db'
import { BufferCache } from './cache'

export const thumbnailWidths: Record<string, number> = JSON.parse(process.env.THUMBNAIL_WIDTH as string)
/** Most photos one album download may contain: each one is resized while the archive is built */
export const downloadMaxImages = Number(process.env.DOWNLOAD_MAX_IMAGES) || 1000

const photosFolder = process.env.PHOTOS_FOLDER as string

const lockBuffer = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-lock-password"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2z" /><path d="M8 11v-4a4 4 0 1 1 8 0v4" /><path d="M15 16h.01" /><path d="M12.01 16h.01" /><path d="M9.02 16h.01" /></svg>
`)

declare global {
    var __resizedImages: BufferCache | undefined
}

/**
 * Screen and export versions made on request, kept in memory. Kept on `globalThis`, so the image and download routes
 * share it.
 */
const resizedImages = global.__resizedImages ??= new BufferCache((Number(process.env.SCREEN_CACHE_MB ?? 256) || 0) * 1024 * 1024)

/** Thumbnails being generated, by path: concurrent first requests of one share its generation */
const thumbnailsInProgress = new Map<string, Promise<{ type: string, size: number, path: string }>>()

/** Rasterized lock watermarks: their width follows the image size, so there are a few hundred at most */
const locks = new BufferCache(8 * 1024 * 1024)

/** Semi-transparent lock watermark of the given width, with the given alpha (0–255) */
function lock(width: number, alpha: number) {
    return locks.get(`${width}-${alpha}`, () => sharp(lockBuffer)
        .resize(width)
        .composite([{
            input: Buffer.from([0, 0, 0, alpha]),
            raw: {
                width: 1,
                height: 1,
                channels: 4,
            },
            tile: true,
            blend: 'dest-in',
        }])
        .toBuffer())
}

/** Photo description shown in the lightbox (returned by the `getImage` action) */
export interface ImageInfo {
    id: number
    description?: string | null
    labels?: Label[]
    info?: CameraSettings
}

/** Exifr keeps an opened file handle which is not exposed in its type definitions */
async function closeExifr(exr: Exifr) {
    await (exr as Exifr & { file?: { close?: () => Promise<void> } }).file?.close?.()
}

function decodeString(value: unknown) {
    return decode(String(value))
}

/** Thrown when an image has no database record */
export class ImageNotFoundError extends Error {}

/** Size and modification time of a photo file, recorded with its metadata so that sync notices when it changes */
export interface FileVersion {
    size: number
    mtime: Date
}

export function fileVersion(stats: Stats): FileVersion {
    return { size: stats.size, mtime: new Date(Math.floor(stats.mtimeMs)) }
}

/** Tags read by exifr, which gives dates as `Date` */
interface Tags {
    [tag: string]: unknown
    CreateDate?: Date
    DateTimeDigitized?: Date
    DateTimeOriginal?: Date
    ModifyDate?: Date
}

/** Camera settings among the tags read by exifr; ISO can come as a list of values */
function cameraSettings(tags: Tags): CameraSettings {
    const settings: CameraSettings = {}
    for (const key of ['FocalLength', 'ISO', 'ExposureTime', 'FNumber'] as const) {
        const value = Array.isArray(tags[key]) ? (tags[key] as unknown[])[0] : tags[key]
        if (typeof value === 'number' && Number.isFinite(value))
            settings[key] = value
    }
    return settings
}

/** Dimensions, caption, shooting time, camera settings and keywords of a photo file */
async function readMetadata(path: string): Promise<{ data: ImageUpdate, labels?: string[] }> {
    const exr = new Exifr({
        tiff: true,
        xmp: true,
        iptc: true,
        exif: true,
        gps: true,
        translateValues: false
    })
    const { width, height, orientation } = await sharp(path).metadata()
    const data: ImageUpdate = { width, height, orientation: orientation ?? 0 }
    let info: Tags
    try {
        await exr.read(path)
        // A file without any metadata gives nothing
        info = (await exr.parse()) ?? {}
    } finally {
        await closeExifr(exr)
    }

    const description = info['Caption'] || info['Headline'] || info['ObjectName']
    if (description !== undefined)
        data.description = decodeString(description)

    // Labels are left as they are when the file has no keywords at all
    const labels = 'Keywords' in info ? ([] as unknown[]).concat(info['Keywords']).map(decodeString) : undefined

    if (data.orientation !== undefined && data.orientation >= 5) {
        data.width = height
        data.height = width
    }

    const stime = info['CreateDate'] || info['DateTimeDigitized'] || info['DateTimeOriginal'] || info['ModifyDate']
    if (stime !== undefined)
        data.stime = stime

    data.exif = cameraSettings(info)

    return { data, labels }
}

export default class Image implements Partial<ImageRecord> {
    id?: number
    name?: string
    bundle?: string
    width?: number
    height?: number
    censored?: number
    description?: string | null
    ctime?: Date | null
    exif?: CameraSettings | null
    path?: string
    labels?: Label[]
    private fetched = false

    static fromId(id: number) {
        const image = new Image()
        image.id = id
        return image
    }

    static fromPath(path: string) {
        const image = new Image()
        image.path = join(photosFolder, path)
        return image
    }

    /** A photo whose database row is already read */
    static fromRecord(record: ImageRecord) {
        const image = new Image()
        Object.assign(image, record)
        image.fetched = true
        return image
    }

    /**
     * Adds a photo to the database. The row is inserted complete, with metadata and labels, in one transaction, so an
     * interrupted sync leaves no half-imported photos behind: the next sync sees the file as new again.
     */
    static async create(bundle: string, name: string, version?: FileVersion) {
        const path = join(photosFolder, bundle, name)
        const { data, labels } = await readMetadata(path)
        await addImage(bundle, name, { ...data, ...(version ?? fileVersion(await stat(path))) }, labels === undefined ? [] : await getLabelIds(labels))
    }

    /** Deletes the photo whose file is gone, and its thumbnails */
    async delete() {
        await this.deleteThumbnails()
        await deleteImage(await this.getId())
    }

    /** Deletes the cached thumbnails of the photo, of every size and variant; they are made again when asked for */
    async deleteThumbnails() {
        const path = await this.ensurePath()
        const folder = join(dirname(path), 'thumbs')
        const name = basename(path)
        let files: string[]
        try {
            files = await readdir(folder)
        } catch (e) {
            if ((e as NodeJS.ErrnoException)?.code === 'ENOENT')
                return
            throw e
        }
        // t<size>-<name>[-vertical][-locked].webp, see makeThumbnail
        for (const file of files)
            if (file.startsWith('t') && file.endsWith('.webp') && /^t[^-]+-(.+?)(-vertical)?(-locked)?\.webp$/.exec(file)?.[1] === name)
                await rm(join(folder, file), { force: true })
    }

    async getId() {
        if (this.id === undefined)
            await this.fetchData()
        return this.id as number
    }

    async ensurePath() {
        if (this.path !== undefined)
            return this.path
        if (this.name === undefined || this.bundle === undefined)
            await this.fetchData()
        this.path = join(photosFolder, this.bundle as string, this.name as string)
        return this.path
    }

    async fetchData() {
        // Do not fetch twice
        if (this.fetched)
            return
        let data: ImageRecord | undefined
        if (this.id !== undefined) {
            // initialized by id
            data = await getImageById(this.id)
        } else if (this.path !== undefined) {
            // initialized by path
            const directory = dirname(this.path)
            const name = basename(this.path)
            const bundle = directory.replace(photosFolder, '')
            data = await getImageByName(bundle, name)
        }
        if (data === undefined)
            throw new ImageNotFoundError(`Image ${this.id ?? this.path} not found`)
        Object.assign(this, data)
        this.fetched = true
    }

    async fetchLabels() {
        this.labels = await getImageLabels(await this.getId())
        return this.labels
    }

    /**
     * Camera settings from the database. Photos imported before they were stored there have none yet: they are read
     * from the file once and stored.
     */
    async getCameraSettings() {
        if (!this.fetched)
            await this.fetchData()
        if (this.exif === undefined || this.exif === null) {
            const exr = new Exifr({
                tiff: true,
                xmp: false,
                iptc: false,
                exif: true,
                gps: false,
                translateValues: false
            })
            let tags: Tags
            try {
                await exr.read(await this.ensurePath())
                tags = (await exr.parse()) ?? {}
            } finally {
                await closeExifr(exr)
            }
            this.exif = cameraSettings(tags)
            await updateImage(await this.getId(), { exif: this.exif })
        }
        return this.exif
    }

    async setLabels(labelNames: string[]) {
        const labels = await getLabelIds(labelNames)
        await setImageLabels(await this.getId(), labels)
    }

    /** Re-reads the metadata of the file, `version` being the file it is read from */
    async updateMetadata(version?: FileVersion) {
        const path = await this.ensurePath()
        const { data, labels } = await readMetadata(path)
        if (labels !== undefined)
            await this.setLabels(labels)
        await updateImage(await this.getId(), { ...data, ...(version ?? fileVersion(await stat(path))) })
    }

    /** Records the file version of a photo imported before versions were recorded, without reading it again */
    async recordVersion(version: FileVersion) {
        await updateImage(await this.getId(), version)
    }

    async getResized(width: number, restricted = false) {
        const path = await this.ensurePath()
        let image = sharp(path, { failOn: 'none' })
            .rotate()
            .resize({ width: width, withoutEnlargement: true })
            .jpeg()

        // Put lock watermark if it is restricted
        if (restricted) {
            const imageWidth = this.width ?? width
            const imageHeight = this.height ?? width
            const lockWidth = imageWidth > imageHeight ? width * imageHeight / imageWidth : width
            image = image
                .blur(5)
                .composite([{
                    input: await lock(Math.floor(lockWidth * 0.5), 127),
                    gravity: 'center',
                }])
        }

        const { data, info } = await image.jpeg().toBuffer({ resolveWithObject: true })

        return { type: 'jpeg', size: info.size, data }
    }

    /**
     * Resized version, from memory when it was made before. The file version (`stats` of the original) is part of the
     * key, so a replaced file is resized again. With `store: false`, a missing version is not kept.
     */
    async getResizedCached(width: number, restricted: boolean, stats: Stats, store = true) {
        const key = `${await this.ensurePath()}\0${stats.size}-${stats.mtimeMs}\0${width}${restricted ? '-locked' : ''}`
        return await resizedImages.get(key, async () => (await this.getResized(width, restricted)).data, store)
    }

    async makeThumbnail(size = 'm', vertical = false, force = false, restricted = false) {
        if (!(size in thumbnailWidths))
            size = 'm'
        // Construct path to thumbnail and return it if file exists
        const imagePath = await this.ensurePath()
        const directory = dirname(imagePath)
        const image = basename(imagePath)
        const path = join(directory, 'thumbs', `t${size}-${image}${vertical ? '-vertical' : ''}${restricted ? '-locked' : ''}.webp`)
        if (!force) {
            try {
                const stats = await stat(path)
                if (stats.size > 0)
                    return { type: 'webp', size: stats.size, path }
            } catch (e) {
                if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') // continue if file not found
                    throw e
            }
        }
        let pending = thumbnailsInProgress.get(path)
        if (pending === undefined) {
            pending = this.writeThumbnail(imagePath, path, size, vertical, restricted)
                .finally(() => thumbnailsInProgress.delete(path))
            thumbnailsInProgress.set(path, pending)
        }
        return await pending
    }

    /**
     * Writes the thumbnail to a temporary file and renames it into place, which is atomic. A generation interrupted
     * by a killed process or a full disk leaves no truncated thumbnail behind, which would be served from then on.
     */
    private async writeThumbnail(imagePath: string, path: string, size: string, vertical: boolean, restricted: boolean) {
        // Create directory if it does not exist
        await mkdir(dirname(path), { recursive: true }) // use recursive to success if directory exists
        // Rescale image
        let thumbnail = sharp(imagePath, { failOn: 'none' })
            .rotate()
            .resize(vertical ? { height: thumbnailWidths[size] } : { width: thumbnailWidths[size] })
        // Put lock watermark if it is restricted
        if (restricted) {
            thumbnail = thumbnail
                .blur(5)
                .composite([{
                    input: await lock(Math.floor(thumbnailWidths[size] * 0.4), 64),
                    gravity: 'center',
                }])
        }
        // Save image
        const temporary = `${path}.${randomUUID()}.tmp`
        try {
            const info = await thumbnail
                .webp({ quality: 80 })
                .toFile(temporary)
            await rename(temporary, path)
            return { type: 'webp', size: info.size, path }
        } catch (e) {
            await rm(temporary, { force: true })
            throw e
        }
    }
}
