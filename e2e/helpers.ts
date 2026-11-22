import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, type Page } from '@playwright/test'
import postgres from 'postgres'
import sharp from 'sharp'

import { authDir, photosFolder } from './env'

export const GEORGIA = '/travel/Georgia/2015'
export const ARMENIA = '/travel/Armenia/2016'
export const FAMILY = '/family/2020'
/** Its only photo is censored, with a label no other photo has */
export const HIDDEN = '/hidden/2020'

export const bundles = [GEORGIA, ARMENIA, FAMILY, HIDDEN]

/** Playwright storage states created by global setup */
export const asUser = join(authDir, 'user.json')
export const asAdmin = join(authDir, 'admin.json')
export const asViewer = join(authDir, 'viewer.json')
export const asImpostor = join(authDir, 'impostor.json')

let sql: postgres.Sql | undefined

/** Direct database access for looking up generated ids */
export function db() {
    sql ??= postgres({ onnotice: () => {}, max: 1 })
    return sql
}

export async function labelId(name: string) {
    const [row] = await db()<{ id: number }[]>`SELECT id FROM label WHERE name = ${name}`
    if (!row)
        throw new Error(`Label ${name} not found`)
    return row.id
}

export async function imageId(bundle: string, name: string) {
    const [row] = await db()<{ id: number }[]>`SELECT id FROM image WHERE bundle = ${bundle} AND name = ${name}`
    if (!row)
        throw new Error(`Image ${bundle}/${name} not found`)
    return row.id
}

export function thumbnails(page: Page) {
    return page.locator('button[id^="thumbnail-"]')
}

export function thumbnail(page: Page, id: number) {
    return page.locator(`#thumbnail-${id}`)
}

export function lightbox(page: Page) {
    return page.locator('.yarl__root')
}

/** Description of the slide currently shown in the lightbox */
export function description(page: Page) {
    return page.locator('.yarl__slide_current .image_description')
}

export function wait(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

/** Number of log rows written for requests from `ip` */
export async function logCount(ip: string) {
    const [{ n }] = await db()<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM log WHERE ip = ${ip}`
    return n
}

/** `Cookie` header of a Playwright storage state, for requests made without Playwright */
export async function cookieHeader(storageState: string) {
    const state: { cookies: { name: string, value: string }[] } = JSON.parse(await readFile(storageState, 'utf8'))
    return state.cookies.map(({ name, value }) => `${name}=${value}`).join('; ')
}

/**
 * Creates an album of `count` photos of noise, without labels, and imports it with `view`, which opens the album
 * page. Photos of noise don't compress, so an archive of them fills the buffers between the server and the client
 * quickly: loopback TCP buffers alone hold 10 MB or more, and 80 photos make about 40 MB. `remove` deletes the album
 * and, through sync, its rows.
 */
export async function noiseAlbum(bundle: string, count: number, view: (bundle: string) => Promise<unknown>) {
    const folder = join(photosFolder, bundle)
    const noise = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 128, sigma: 64 } } })
        .jpeg()
        .toBuffer()
    const names = Array.from({ length: count }, (_, i) => `n${String(i).padStart(2, '0')}.jpg`)
    const remove = async () => {
        // Sync removes the rows of deleted files, a missing folder is just reported as not found
        for (const name of names)
            await rm(join(folder, name), { force: true })
        await view(bundle)
        await rm(folder, { recursive: true, force: true })
    }

    await rm(folder, { recursive: true, force: true })
    await mkdir(folder)
    try {
        for (const name of names)
            await writeFile(join(folder, name), noise)
        // A long sync goes on in the background
        await expect.poll(async () => {
            await view(bundle)
            const [{ n }] = await db()<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM image WHERE bundle = ${bundle}`
            return n
        }, { timeout: 30_000 }).toBe(count)
    } catch (e) {
        await remove()
        throw e
    }
    const ids = (await db()<{ id: number }[]>`SELECT id FROM image WHERE bundle = ${bundle} ORDER BY name`).map(row => row.id)
    return { ids, remove }
}
