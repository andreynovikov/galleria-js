import { mkdir, stat } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { Exifr } from 'exifr'
import sharp from 'sharp'
import { decode } from 'utf8'

import { getImageById, getImageByName, addImage, deleteImage, updateImage, getLabelIds, getImageLabels, setImageLabels } from './db'
import type { ImageRecord, ImageUpdate, Label } from './db'

export const thumbnailWidths: Record<string, number> = JSON.parse(process.env.THUMBNAIL_WIDTH as string)
/** Most photos one album download may contain: each one is resized while the archive is built */
export const downloadMaxImages = Number(process.env.DOWNLOAD_MAX_IMAGES) || 1000

const photosFolder = process.env.PHOTOS_FOLDER as string

const lockBuffer = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-lock-password"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2z" /><path d="M8 11v-4a4 4 0 1 1 8 0v4" /><path d="M15 16h.01" /><path d="M12.01 16h.01" /><path d="M9.02 16h.01" /></svg>
`)

export interface ExifInfo {
    FocalLength?: number
    ISO?: number
    ExposureTime?: number
    FNumber?: number
    [key: string]: unknown
}

/** Photo description shown in the lightbox (returned by the `getImage` action) */
export interface ImageInfo {
    id: number
    description?: string | null
    labels?: Label[]
    info?: Pick<ExifInfo, 'FocalLength' | 'ISO' | 'ExposureTime' | 'FNumber'>
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

export default class Image implements Partial<ImageRecord> {
    id?: number
    name?: string
    bundle?: string
    width?: number
    height?: number
    censored?: number
    description?: string | null
    ctime?: Date | null
    path?: string
    labels?: Label[]
    info?: ExifInfo
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

    static async create(bundle: string, name: string) {
        const { id, ctime } = await addImage(bundle, name)
        const object = Image.fromId(id)
        object.name = name
        object.bundle = bundle
        object.ctime = ctime
        await object.updateMetadata()
    }

    async delete() {
        // Do nothing with file as it's already gone
        await deleteImage(await this.getId())
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

    async expand() {
        const path = await this.ensurePath()
        if (this.info)
            return

        if (this.labels === undefined)
            await this.fetchLabels()

        // Only camera settings are read, the description comes from the database
        const exr = new Exifr({
            tiff: true,
            xmp: false,
            iptc: false,
            exif: true,
            gps: false,
            translateValues: false
        })
        await exr.read(path)
        this.info = await exr.parse()
        await closeExifr(exr)
    }

    async setLabels(labelNames: string[]) {
        const labels = await getLabelIds(labelNames)
        await setImageLabels(await this.getId(), labels)
    }

    async updateMetadata() {
        const path = await this.ensurePath()
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
        await exr.read(path)
        const info = await exr.parse()
        await closeExifr(exr)

        const description = info['Caption'] || info['Headline'] || info['ObjectName']
        if (description !== undefined)
            data.description = decodeString(description)

        if ('Keywords' in info) {
            const labels = ([] as unknown[]).concat(info['Keywords']).map(decodeString)
            await this.setLabels(labels)
        }

        if (data.orientation !== undefined && data.orientation >= 5) {
            data.width = height
            data.height = width
        }

        const stime = info['CreateDate'] || info['DateTimeDigitized'] || info['DateTimeOriginal'] || info['ModifyDate']
        if (stime !== undefined)
            data.stime = stime

        await updateImage(await this.getId(), data)
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
            const lock = await sharp(lockBuffer)
                .resize(Math.floor(lockWidth * 0.5))
                .composite([{
                    input: Buffer.from([0, 0, 0, 127]),
                    raw: {
                        width: 1,
                        height: 1,
                        channels: 4,
                    },
                    tile: true,
                    blend: 'dest-in',
                }])
                .toBuffer()

            image = image
                .blur(5)
                .composite([{
                    input: lock,
                    gravity: 'center',
                }])
        }

        const { data, info } = await image.jpeg().toBuffer({ resolveWithObject: true })

        return { type: 'jpeg', size: info.size, data }
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
        // Create directory if it does not exist
        await mkdir(join(directory, 'thumbs'), { recursive: true }) // use recursive to success if directory exists
        // Rescale image
        let thumbnail = sharp(imagePath, { failOn: 'none' })
            .rotate()
            .resize(vertical ? { height: thumbnailWidths[size] } : { width: thumbnailWidths[size] })
        // Put lock watermark if it is restricted
        if (restricted) {
            const lock = await sharp(lockBuffer)
                .resize(Math.floor(thumbnailWidths[size] * 0.4))
                .composite([{
                    input: Buffer.from([0, 0, 0, 64]),
                    raw: {
                        width: 1,
                        height: 1,
                        channels: 4,
                    },
                    tile: true,
                    blend: 'dest-in',
                }])
                .toBuffer()

            thumbnail = thumbnail
                .blur(5)
                .composite([{
                    input: lock,
                    gravity: 'center',
                }])
        }
        // Save image
        const info = await thumbnail
            .webp({ quality: 80 })
            .toFile(path)
        return { type: 'webp', size: info.size, path }
    }
}
