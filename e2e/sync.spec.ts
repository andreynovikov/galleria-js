import { copyFile, mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { fixturesFolder, photosFolder } from './env'
import { ARMENIA, GEORGIA, asAdmin, db, description, imageId, settled, thumbnail, thumbnails } from './helpers'
import { scanPhotos } from '../lib/images'

/** Copies a photo in, dated as a finished copy: sync leaves files modified within the last minute for later */
async function copyIn(source: string, target: string) {
    await copyFile(source, target)
    await settled(target)
}

test.describe('album sync', () => {
    test('picks up added, changed and removed files', async ({ page, browser }, testInfo) => {
        // Unique album per test run; files have no labels so other tests are not affected
        const bundle = `/sync-${testInfo.project.name}-${testInfo.repeatEachIndex}`
        const folder = join(photosFolder, bundle)
        const source = join(fixturesFolder, 'photos', ARMENIA, 'IMG_0102.jpg')

        await rm(folder, { recursive: true, force: true })
        await mkdir(folder)
        try {
            // The landing page album list is cached, until a sync changes the album
            const albumCount = async () => {
                await page.goto('/')
                const link = page.getByRole('link', { name: bundle, exact: true })
                if (await link.count() === 0)
                    return null
                return await page.getByRole('listitem').filter({ has: link }).textContent()
            }

            await copyIn(source, join(folder, 'a.jpg'))
            await page.goto(bundle)
            await expect(thumbnails(page)).toHaveCount(1)
            expect(await albumCount()).toContain('(1)')

            await copyIn(source, join(folder, 'b.jpg'))
            await page.goto(bundle)
            await expect(thumbnails(page)).toHaveCount(2)
            expect(await albumCount()).toContain('(2)')

            // A file saved over through a temporary one, as editors do, changes the folder: the next view reads its
            // metadata again, and its thumbnails are made again
            const id = await imageId(bundle, 'a.jpg')
            const thumbnailUrl = `${bundle}/a.jpg?format=thumbnail&size=s`
            const before = await (await page.request.get(thumbnailUrl)).body()
            const temporary = join(folder, 'a.jpg.part')
            await copyIn(join(fixturesFolder, 'extra', 'updated.jpg'), temporary)
            await rename(temporary, join(folder, 'a.jpg'))
            await page.goto(bundle)
            await thumbnail(page, id).click()
            await expect(description(page).locator('.title')).toHaveText('Обновлённое описание')
            expect((await (await page.request.get(thumbnailUrl)).body()).equals(before)).toBe(false)

            // Admins can still have all metadata read again
            const admin = await browser.newContext({ storageState: asAdmin })
            try {
                const adminPage = await admin.newPage()
                await adminPage.goto(`${bundle}?updatemetadata=1`)
                await thumbnail(adminPage, id).click()
                await expect(description(adminPage).locator('.title')).toHaveText('Обновлённое описание')
            } finally {
                await admin.close()
            }

            await rm(join(folder, 'b.jpg'))
            await page.goto(bundle)
            await expect(thumbnails(page)).toHaveCount(1)

            await rm(join(folder, 'a.jpg'))
            await page.goto(bundle)
            await expect(page.getByRole('img', { name: 'Nothing found' })).toBeVisible()
            expect(await albumCount()).toBeNull()
        } finally {
            await rm(folder, { recursive: true, force: true })
        }

        const response = await page.goto(bundle)
        expect(response?.status()).toBe(404)
    })

    test('serves albums and photos whose names need encoding in URLs', async ({ page, request }, testInfo) => {
        // Unique album; the file has no labels so other tests are not affected
        const bundle = `/Альбом #1 (${testInfo.project.name}-${testInfo.repeatEachIndex})`
        const folder = join(photosFolder, bundle)
        const file = join(folder, 'фото 1.jpg')

        await rm(folder, { recursive: true, force: true })
        await mkdir(folder)
        try {
            await copyIn(join(fixturesFolder, 'photos', ARMENIA, 'IMG_0102.jpg'), file)
            expect((await request.get(encodeURI(bundle).replace('#', '%23'))).status()).toBe(200)

            await page.goto('/')
            await page.getByRole('link', { name: bundle, exact: true }).click()
            await expect(page).toHaveTitle(new RegExp(bundle.slice(1).replace(/[()]/g, '\\$&')))
            await expect(thumbnails(page)).toHaveCount(1)
            const image = thumbnails(page).first().locator('img')
            await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete ? img.naturalWidth : 0)).toBeGreaterThan(0)

            await thumbnails(page).first().click()
            const slide = page.locator('.yarl__slide_current img')
            await expect.poll(() => slide.evaluate((img: HTMLImageElement) => img.complete ? img.naturalWidth : 0)).toBe(1200)
        } finally {
            // Sync removes the row of the deleted file, a missing folder is just reported as not found
            await rm(file, { force: true })
            await request.get(encodeURI(bundle).replace('#', '%23'))
            await rm(folder, { recursive: true, force: true })
        }
    })

    test('rejects paths which would leave their folder once decoded', async ({ request }) => {
        for (const path of [`${ARMENIA}%2F..%2F..%2F2016`, '/travel%2FArmenia%2F2016', '/%2E%2E%2Ftravel'])
            expect((await request.get(path)).status(), path).toBe(404)
        for (const path of [`/travel%2FArmenia%2F2016/IMG_0101.jpg`, `${ARMENIA}/..%2F2016%2FIMG_0101.jpg`])
            expect((await request.get(`${path}?format=original`)).status(), path).toBe(404)
        // Malformed percent-encoding
        for (const path of ['/%E0%A4%A', `${ARMENIA}/%E0%A4%A.jpg`])
            expect((await request.get(path)).status(), path).toBe(400)
    })

    test('imports each file once when an album is viewed concurrently', async ({ request }, testInfo) => {
        const bundle = `/concurrent-${testInfo.project.name}-${testInfo.repeatEachIndex}`
        const folder = join(photosFolder, bundle)
        const source = join(fixturesFolder, 'photos', ARMENIA, 'IMG_0102.jpg')
        const names = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg']

        await rm(folder, { recursive: true, force: true })
        await mkdir(folder)
        try {
            for (const name of names)
                await copyIn(source, join(folder, name))
            const responses = await Promise.all(Array.from({ length: 4 }, () => request.get(bundle)))
            for (const response of responses)
                expect(response.status()).toBe(200)
            const rows = await db()<{ name: string, width: number }[]>`SELECT name, width FROM image WHERE bundle = ${bundle} ORDER BY name`
            expect(rows.map(row => row.name)).toEqual(names)
            // Rows are inserted with their metadata
            for (const row of rows)
                expect(row.width).toBe(1600)
        } finally {
            // Sync removes the rows of deleted files, a missing folder is just reported as not found
            for (const name of names)
                await rm(join(folder, name), { force: true })
            await request.get(bundle)
            await rm(folder, { recursive: true, force: true })
        }
    })

    test('restricts photos with a restricted label which sync creates', async ({ page, request }, testInfo) => {
        const bundle = `/secret-${testInfo.project.name}-${testInfo.repeatEachIndex}`
        const folder = join(photosFolder, bundle)
        const file = join(folder, 'a.jpg')

        await rm(folder, { recursive: true, force: true })
        await mkdir(folder)
        try {
            // Restricted labels are resolved before the `Secret` label exists
            expect((await request.get(`${GEORGIA}/IMG_0003.jpg?format=original`)).status()).toBe(403)

            await copyIn(join(fixturesFolder, 'extra', 'secret.jpg'), file)
            await page.goto(bundle)
            await expect(thumbnails(page)).toHaveCount(1)
            expect((await request.get(`${bundle}/a.jpg?format=original`)).status()).toBe(403)

            await rm(file)
            await page.reload()
            await expect(page.getByRole('img', { name: 'Nothing found' })).toBeVisible()
        } finally {
            await rm(folder, { recursive: true, force: true })
        }
    })

    test('leaves files being copied in for a later sync', async ({ page }, testInfo) => {
        const bundle = `/copying-${testInfo.project.name}-${testInfo.repeatEachIndex}`
        const folder = join(photosFolder, bundle)
        const file = join(folder, 'a.jpg')
        await rm(folder, { recursive: true, force: true })
        await mkdir(folder)
        try {
            // Just written, as during a copy
            await copyFile(join(fixturesFolder, 'photos', ARMENIA, 'IMG_0102.jpg'), file)
            await page.goto(bundle)
            await expect(page.getByRole('img', { name: 'Nothing found' })).toBeVisible()

            // The copy is done, but the folder is the same as at that sync: views within a minute don't list it
            // again. The periodic scan does.
            await settled(file)
            await page.goto(bundle)
            await expect(page.getByRole('img', { name: 'Nothing found' })).toBeVisible()
            await scanPhotos(bundle)
            await page.goto(bundle)
            await expect(thumbnails(page)).toHaveCount(1)
        } finally {
            // Removing the file changes the folder, so this view syncs and removes its row
            await rm(file, { force: true })
            await page.goto(bundle)
            await rm(folder, { recursive: true, force: true })
        }
    })

    test('scan imports albums nobody opened, and removes the ones whose folders are gone', async ({}, testInfo) => {
        const parent = `/scan-${testInfo.project.name}-${testInfo.repeatEachIndex}`
        const source = join(fixturesFolder, 'photos', ARMENIA, 'IMG_0102.jpg')
        const count = async (bundle: string) =>
            (await db()<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM image WHERE bundle = ${bundle}`)[0].n
        await rm(join(photosFolder, parent), { recursive: true, force: true })
        try {
            for (const album of ['one', 'two/nested']) {
                await mkdir(join(photosFolder, parent, album), { recursive: true })
                await copyIn(source, join(photosFolder, parent, album, 'a.jpg'))
            }
            expect(await scanPhotos(parent)).toEqual({ synced: 2, removed: 0 })
            expect(await count(`${parent}/one`)).toBe(1)
            expect(await count(`${parent}/two/nested`)).toBe(1)

            await rm(join(photosFolder, parent, 'two'), { recursive: true })
            expect(await scanPhotos(parent)).toEqual({ synced: 1, removed: 1 })
            expect(await count(`${parent}/two/nested`)).toBe(0)
            expect(await count(`${parent}/one`)).toBe(1)

            // A missing photos folder is an error, not an empty archive (an unmounted disk): nothing is removed
            await rm(join(photosFolder, parent), { recursive: true })
            expect(await scanPhotos(parent)).toEqual({ synced: 0, removed: 0 })
            expect(await count(`${parent}/one`)).toBe(1)
        } finally {
            await rm(join(photosFolder, parent), { recursive: true, force: true })
            await db()`DELETE FROM image WHERE bundle = ${parent} OR starts_with(bundle, ${parent + '/'})`
        }
    })
})
