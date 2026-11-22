import { stat } from 'fs/promises'
import { Readable } from 'stream'

import type { NextRequest } from 'next/server'

import { ZipArchive } from 'archiver'

import Image, { downloadMaxImages } from '@/lib/image'
import { getImagesByIds, writeLog, type LogMeta, type VisitorRef } from '@/lib/db'
import { clientIp, uaMeta, ACTION_DOWNLOAD } from '@/lib/utils'
import { censorshipLevel, getSession } from '@/auth'

const basePath = process.env.BASE_PATH ?? ''
const screenMaxWidth = Number(process.env.SCREEN_MAX_WIDTH)

/** A photo with its name in the archive */
interface Photo {
    image: Image
    name: string
}

interface Entry {
    id: number
    name: string
    data: Buffer
}

/**
 * Photos the visitor may download, in the order asked. Censored photos are skipped the same way as missing ones.
 * A name which several photos share is put in a folder named after the album path. Names are compared ignoring case,
 * because they collide when extracted on Windows and macOS.
 */
async function listPhotos(ids: number[], level: number): Promise<Photo[]> {
    const records = new Map((await getImagesByIds(ids)).map(record => [record.id, record]))
    const allowed = ids.flatMap(id => {
        const record = records.get(id)
        return record !== undefined && record.censored <= level ? [record] : []
    })
    const counts = new Map<string, number>()
    for (const { name } of allowed)
        counts.set(name.toLowerCase(), (counts.get(name.toLowerCase()) ?? 0) + 1)
    return allowed.map(record => ({
        image: Image.fromRecord(record),
        name: (counts.get(record.name.toLowerCase()) ?? 0) > 1
            ? [...record.bundle.split('/').filter(Boolean), record.name].join('/')
            : record.name
    }))
}

/** File name of the archive: the path the albums have in common, such as `travel-Georgia-2015.zip` */
function archiveName(photos: Photo[]) {
    const paths = photos.map(({ image }) => (image.bundle as string).split('/').filter(Boolean))
    let common = paths[0] ?? []
    for (const path of paths) {
        let length = 0
        while (length < common.length && path[length] === common[length])
            length++
        common = common.slice(0, length)
    }
    return `${common.join('-') || 'images'}.zip`
}

/** `Content-Disposition` with the UTF-8 name, and a plain ASCII one for old clients (RFC 6266) */
function contentDisposition(filename: string) {
    const fallback = /^[\x20-\x7e]+$/.test(filename) && !/["\\]/.test(filename) ? filename : 'images.zip'
    const encoded = encodeURIComponent(filename).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

/** Screen version of a photo for the archive, or `null` for a photo which is skipped */
async function prepare({ image, name }: Photo): Promise<Entry | null> {
    try {
        let width = screenMaxWidth
        if (image.width !== undefined && image.height !== undefined && image.width < image.height)
            width = Math.round(image.width / image.height * width)
        const stats = await stat(await image.ensurePath())
        // Versions viewed recently are reused, but those made here are not kept: one download could evict them all
        const data = await image.getResizedCached(width, false, stats, false)
        return { id: image.id as number, name, data }
    } catch (e) {
        // A broken or deleted file shouldn't break the archive halfway through
        console.log(`Download: skipping photo ${image.id}`, e)
        return null
    }
}

/**
 * Appends a photo and waits until its data has passed into the archive. The data is given as a stream, which archiver
 * pipes with backpressure, so this waits for the client to read the previous photos. (For a buffer, archiver reports
 * the entry right away.)
 */
function append(archive: ZipArchive, entry: Entry) {
    return new Promise<void>((resolve, reject) => {
        const done = (error?: Error) => {
            archive.off('entry', onEntry)
            archive.off('close', onClose)
            archive.off('error', done)
            if (error)
                reject(error)
            else
                resolve()
        }
        const onEntry = () => done()
        const onClose = () => done(new Error('Archive closed'))
        archive.on('entry', onEntry)
        archive.on('close', onClose)
        archive.on('error', done)
        archive.append(Readable.from([entry.data]), { name: entry.name })
    })
}

/**
 * Adds the photos one by one, resizing the next one while the current one is sent. Stops when the client
 * disconnects (the response stream destroys the archive).
 */
async function fill(archive: ZipArchive, photos: Photo[], ip: string, user: VisitorRef, meta: LogMeta) {
    let next = photos.length > 0 ? prepare(photos[0]) : null
    for (let i = 0; next !== null; i++) {
        const entry = await next
        if (archive.destroyed)
            return
        next = i + 1 < photos.length ? prepare(photos[i + 1]) : null
        if (entry === null)
            continue
        await append(archive, entry)
        // A failed log write shouldn't break the download
        await writeLog(entry.id, ACTION_DOWNLOAD, ip, user, meta).catch(error => console.log('Download: log failed', error))
    }
    await archive.finalize()
}

export async function GET(request: NextRequest) {
    const session = await getSession()

    if (!session?.user) {
        const callbackUrl = `${basePath}${request.nextUrl.pathname}${request.nextUrl.search}`
        return Response.redirect(new URL(`${basePath}/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`, request.nextUrl.origin), 307)
    }

    const user = session.user
    const level = censorshipLevel(session)
    const ip = clientIp(request.headers)
    const meta = uaMeta(request.headers)

    const ids = [...new Set((request.nextUrl.searchParams.get('images') ?? '').split(',').map(Number))]
        .filter(id => Number.isInteger(id) && id > 0)
    if (ids.length > downloadMaxImages)
        return new Response(`Too many photos, at most ${downloadMaxImages} can be downloaded at once`, {
            status: 400
        })
    // Every name is known before the first byte: the archive name goes into the headers
    const photos = await listPhotos(ids, level)

    // JPEG doesn't compress, so the photos are stored as they are
    const archive = new ZipArchive({ store: true })
    archive.on('error', error => {
        if (!archive.destroyed)
            console.log('Download: archive failed', error)
    })
    fill(archive, photos, ip, user, meta).catch(error => {
        // A disconnected client is not a failure
        if (!archive.destroyed)
            archive.destroy(error)
    })

    // The archive is read as fast as the client receives it
    return new Response(Readable.toWeb(archive) as ReadableStream<Uint8Array>, {
        status: 200,
        headers: new Headers({
            'content-disposition': contentDisposition(archiveName(photos)),
            'content-type': 'application/zip'
        })
    })
}
