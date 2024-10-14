import { mkdir, stat } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { Exifr } from 'exifr'
import sharp from 'sharp'
import { decode } from 'utf8'

import { getImageById, getImageByName, addImage, updateImage, getLabelIds, getImageLabels, setImageLabels } from './db'

export const thumbnailWidths = JSON.parse(process.env.THUMBNAIL_WIDTH)

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

    async expand() {
        await this.ensurePath()
        if (!!this.info)
            return

        this.labels = await getImageLabels(this.id)

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
        await exr.read(this.path)
        const info = await exr.parse()
        await exr.file?.close?.()

        if ('Keywords' in info) {
            const labels = []
            if (Array.isArray(info['Keywords']))
                info['Keywords'].forEach(label => labels.push(decode(label)))
            else
                labels.push(decode(info['Keywords']))
            this.setLabels(labels)
        }

        if ((orientation || 0) >= 5) {
            data.width = height
            data.height = width
        }

        const stime = info['CreateDate'] || info['CreateDate'] || info['DateTimeDigitized']
        if (stime !== undefined)
            data.stime = stime

        await updateImage(this.id, data)
    }

    async getResized(width) {
        await this.ensurePath()
        const { data, info } = await sharp(this.path)
            .rotate()
            .resize({ width: width })
            .jpeg()
            .toBuffer({ resolveWithObject: true })
        return { type: 'jpeg', size: info.size, data }        
    }

    async makeThumbnail(size='m', force=false) {
        if (!(size in thumbnailWidths))
            size = 'm'
        // Construct path to thumbnail and return it if file exists
        await this.ensurePath()
        const directory = dirname(this.path)
        const image = basename(this.path)
        const path = join(directory, 'thumbs', `t${size}-${image}.webp`)
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
        // Rescale and save image
        await sharp(this.path)
            .rotate()
            .resize({ width: thumbnailWidths[size] })
            .webp({ quality: 80 })
            .toFile(path)
            .then(info => {
                size = info.size
            })
        return { type: 'webp', size, path }
    }
}
