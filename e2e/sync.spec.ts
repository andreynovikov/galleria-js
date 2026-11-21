import { copyFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { fixturesFolder, photosFolder } from './env'
import { ARMENIA, description, imageId, thumbnail, thumbnails } from './helpers'

test.describe('album sync', () => {
    test('picks up added, changed and removed files', async ({ page }, testInfo) => {
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

            // Metadata is re-read only when requested
            await copyFile(join(fixturesFolder, 'extra', 'updated.jpg'), join(folder, 'a.jpg'))
            const id = await imageId(bundle, 'a.jpg')
            await page.goto(`${bundle}?updatemetadata=1`)
            await thumbnail(page, id).click()
            await expect(description(page).locator('.title')).toHaveText('Обновлённое описание')

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
})
