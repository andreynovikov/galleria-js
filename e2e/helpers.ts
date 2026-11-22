import { join } from 'node:path'

import type { Page } from '@playwright/test'
import postgres from 'postgres'

import { authDir } from './env'

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
