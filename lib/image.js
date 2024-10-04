import { mkdir, stat } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { Exifr } from 'exifr'
import sharp from 'sharp'

import { getImageById, addImage, updateImage } from './db'

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
            // bundle = os.path.dirname(self.path)
            // name = os.path.basename(self.path)
            // bundle = bundle.replace(config.ROOT_DIR, '')
            // data = db.fetch("SELECT * FROM " + db.tbl_image + " WHERE bundle=%s AND name=%s", [bundle, name], one=True)
        }
        for (const [key, value] of Object.entries(data))
            this[key] = value
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

        if ((orientation || 0) >= 5) {
            data.width = height
            data.height = width
        }

        const stime = info['CreateDate'] || info['CreateDate'] || info['DateTimeDigitized']
        if (stime !== undefined)
            data.stime = stime

        await updateImage(this.id, data)
    }

    async makeThumbnail(size='m', force=false) {
        if (!(size in thumbnailWidths))
            size = 'm'
        // Construct path to thumbnail and return it if file exists
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
