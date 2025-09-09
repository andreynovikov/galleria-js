import { mkdir, stat } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { Exifr } from 'exifr'
import sharp from 'sharp'
import { decode } from 'utf8'

import { getImageById, getImageByName, addImage, deleteImage, updateImage, getLabelIds, getImageLabels, setImageLabels } from './db'

export const thumbnailWidths = JSON.parse(process.env.THUMBNAIL_WIDTH)

const lockBuffer = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-lock-password"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2z" /><path d="M8 11v-4a4 4 0 1 1 8 0v4" /><path d="M15 16h.01" /><path d="M12.01 16h.01" /><path d="M9.02 16h.01" /></svg>
`)

export default class Image {
    static fromId(id) {
        const image = new Image()
        image.id = id
        return image
    }

    static fromPath(path) {
        const image = new Image()
        image.path = join(process.env.PHOTOS_FOLDER, path)
        return image
    }

    static async create(bundle, name) {
        const { id, ctime } = await addImage(bundle, name)
        const object = Image.fromId(id)
        object.name = name
        object.bundle = bundle
        object.ctime = ctime
        await object.updateMetadata()
    }

    async delete() {
        // Do nothing with file as it's already gone
        await deleteImage(this.id)
    }

    async ensurePath() {
        if (Object.hasOwn(this, 'path'))
            return
        if (!Object.hasOwn(this, 'name'))
            await this.fetchData()
    	this.path = join(process.env.PHOTOS_FOLDER, this.bundle, this.name)
    }

    async fetchData() {
        // Do not fetch twice
        if (Object.hasOwn(this, 'ctime'))
            return
        let data = {}
        if (Object.hasOwn(this, 'id')) {
            // initialized by id
            data = await getImageById(this.id)
        } else {
            // initialized by path
            const directory = dirname(this.path)
            const name = basename(this.path)
            const bundle = directory.replace(process.env.PHOTOS_FOLDER, '')
            data = await getImageByName(bundle, name)
        }
        for (const [key, value] of Object.entries(data))
            this[key] = value
    }

    async fetchLabels() {
        if (!Object.hasOwn(this, 'id'))
	    await this.fetchData()
        this.labels = await getImageLabels(this.id)
    }

    async expand() {
        await this.ensurePath()
        if (!!this.info)
            return

        await this.fetchLabels()

        const exr = new Exifr({
            tiff: true,
            xmp: false,
            iptc: true,
            ifd0: false,
            exif: true,
            gps: false,
            translateValues: false
        })
        await exr.read(this.path)
        this.info = await exr.parse()
        await exr.file?.close?.()
    }

    async setLabels(labelNames) {
        const labels = await getLabelIds(labelNames)
        setImageLabels(this.id, labels)
    }

    async updateMetadata() {
        await this.ensurePath()
        const exr = new Exifr({
            tiff: true,
            xmp: true,
            iptc: true,
            ifd0: true,
            exif: true,
            gps: true,
            translateValues: false
        })
        const { width, height, orientation } = await sharp(this.path).metadata()
        const data = { width, height, orientation }
        data.orientation ??= 0
        await exr.read(this.path)
        const info = await exr.parse()
        await exr.file?.close?.()

        const description = info['Caption'] || info['Headline'] || info['ObjectName']
        if (description !== undefined)
            data.description = decode(description)

        if ('Keywords' in info) {
            const labels = []
            if (Array.isArray(info['Keywords']))
                info['Keywords'].forEach(label => labels.push(decode(label)))
            else
                labels.push(decode(info['Keywords']))
            this.setLabels(labels)
        }

        if (data.orientation >= 5) {
            data.width = height
            data.height = width
        }

        const stime = info['CreateDate'] || info['DateTimeDigitized'] || info['DateTimeOriginal'] || info['ModifyDate']
        if (stime !== undefined)
            data.stime = stime

        await updateImage(this.id, data)
    }

    async getResized(width, restricted=false) {
        await this.ensurePath()
        let image = await sharp(this.path, { failOnError: false })
            .rotate()
            .resize({ width: width, withoutEnlargement: true })
            .jpeg()

        // Put lock watermark if it is restricted
        if (restricted) {
            const lockWidth = this.width > this.height ? width * this.height / this.width : width
            const lock = await sharp(lockBuffer)
                .resize(Math.floor(lockWidth * 0.5))
                .composite([{
                    input: Buffer.from([0,0,0,127]),
                    raw: {
                        width: 1,
                        height: 1,
                        channels: 4,
                    },
                    tile: true,
                    blend: 'dest-in',
                }])
                .toBuffer()

            image = await image
                .blur(5)
                .composite([{
                    input: lock,
                    gravity: 'center',
                }])
        }

        const { data, info } = await image.jpeg().toBuffer({ resolveWithObject: true })

        return { type: 'jpeg', size: info.size, data }        
    }

    async makeThumbnail(size='m', vertical=false, force=false, restricted=false) {
        if (!(size in thumbnailWidths))
            size = 'm'
        // Construct path to thumbnail and return it if file exists
        await this.ensurePath()
        const directory = dirname(this.path)
        const image = basename(this.path)
        const path = join(directory, 'thumbs', `t${size}-${image}${vertical ? '-vertical' : ''}${restricted ? '-locked' : ''}.webp`)
        if (!force) {
            try {
                const stats = await stat(path)
                size = stats.size
                if (size > 0)
                    return { type: 'webp', size, path }
            } catch (e) {
                if (e?.code !== 'ENOENT') // continue if file not found
                    throw e
            }
        }
        // Create directory if it does not exist
        await mkdir(join(directory, 'thumbs'), { recursive: true }) // use recursive to success if directory exists
        // Rescale image
        let thumbnail = await sharp(this.path, { failOnError: false })
            .rotate()
            .resize(vertical ? { height: thumbnailWidths[size] } : { width: thumbnailWidths[size] })
        // Put lock watermark if it is restricted
        if (restricted) {
            const lock = await sharp(lockBuffer)
                .resize(Math.floor(thumbnailWidths[size] * 0.4))
                .composite([{
                    input: Buffer.from([0,0,0,64]),
                    raw: {
                        width: 1,
                        height: 1,
                        channels: 4,
                    },
                    tile: true,
                    blend: 'dest-in',
                }])
                .toBuffer()

            thumbnail = await thumbnail
                .blur(5)
                .composite([{
                    input: lock,
                    gravity: 'center',
                }])
        }
        // Save image
        await thumbnail
            .webp({ quality: 80 })
            .toFile(path)
            .then(info => {
                size = info.size
            })
        return { type: 'webp', size, path }
    }
}
