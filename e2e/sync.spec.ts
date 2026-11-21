import { copyFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { fixturesFolder, photosFolder } from './env'
import { ARMENIA, GEORGIA, asAdmin, description, imageId, thumbnail, thumbnails } from './helpers'

test.describe('album sync', () => {
    test('picks up added, changed and removed files', async ({ page, browser }, testInfo) => {
        // Unique album per test run; files have no labels so other tests are not affected
        const bundle = `/sync-${testInfo.project.name}-${testInfo.repeatEachIndex}`
        const folder = join(photosFolder, bundle)
        const source = join(fixturesFolder, 'photos', ARMENIA, 'IMG_0102.jpg')

        await rm(folder, { recursive: true, force: true })
        await mkdir(folder)
        try {
            await copyFile(source, join(folder, 'a.jpg'))
            await page.goto(bundle)
            await expect(thumbnails(page)).toHaveCount(1)

            await copyFile(source, join(folder, 'b.jpg'))
            await page.reload()
            await expect(thumbnails(page)).toHaveCount(2)

            // Metadata is re-read only when an admin requests it
            await copyFile(join(fixturesFolder, 'extra', 'updated.jpg'), join(folder, 'a.jpg'))
            const id = await imageId(bundle, 'a.jpg')
            await page.goto(`${bundle}?updatemetadata=1`)
            await thumbnail(page, id).click()
            await expect(description(page).locator('.title')).toHaveText('Без тегов')

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
            await page.reload()
            await expect(page.getByRole('img', { name: 'Nothing found' })).toBeVisible()
        } finally {
            await rm(folder, { recursive: true, force: true })
        }

        const response = await page.goto(bundle)
        expect(response?.status()).toBe(404)
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

            await copyFile(join(fixturesFolder, 'extra', 'secret.jpg'), file)
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
})
