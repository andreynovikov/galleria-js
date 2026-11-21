import { expect, test } from '@playwright/test'

import { ARMENIA, GEORGIA, asUser, imageId, lightbox, thumbnail, thumbnails } from './helpers'

test.describe('anonymous visitor', () => {
    test('is asked to sign in to see history', async ({ page }) => {
        await page.goto('/history')
        await expect(page).toHaveURL(`/api/auth/signin?callbackUrl=${encodeURIComponent('/history')}`)
        for (const provider of ['GitHub', 'Google', 'Mail.ru', 'Yandex', 'VK'])
            await expect(page.getByRole('button', { name: `Sign in with ${provider}` })).toBeVisible()
    })

    test('is asked to sign in to filter by restricted label', async ({ page }) => {
        await page.goto('/?-filt.labels=Private')
        await expect(page).toHaveURL(`/api/auth/signin?callbackUrl=${encodeURIComponent('/?-filt.labels=Private')}`)
    })

    test('can not download album', async ({ page }) => {
        await page.goto(GEORGIA)
        await expect(thumbnails(page)).toHaveCount(3)
        await expect(page.getByRole('button', { name: 'Скачать все фотографии' })).toHaveCount(0)
    })
})

test.describe('signed-in visitor', () => {
    test.use({ storageState: asUser })

    test('can filter by restricted label', async ({ page }) => {
        await page.goto('/?-filt.labels=Private')
        await expect(page).toHaveTitle('Фотографии с тегом Private')
        await expect(thumbnails(page)).toHaveCount(1)
    })

    test('can view restricted photo', async ({ page }) => {
        const id = await imageId(GEORGIA, 'IMG_0003.jpg')
        await page.goto(GEORGIA)
        await thumbnail(page, id).click()
        await expect(lightbox(page)).toBeVisible()
        await expect(lightbox(page).locator('.yarl__slide_current img')).toHaveAttribute('src', `${GEORGIA}/IMG_0003.jpg?sid=e2e-user`)
    })

    test('sees photos allowed by censorship level', async ({ page }) => {
        await page.goto(ARMENIA)
        await expect(thumbnails(page)).toHaveCount(2)
        await expect(thumbnail(page, await imageId(ARMENIA, 'IMG_0102.jpg'))).toBeVisible()
    })

    test('downloads album', async ({ page }) => {
        await page.goto(ARMENIA)
        await expect(thumbnails(page)).toHaveCount(2)
        const download = page.waitForEvent('download')
        await page.getByRole('button', { name: 'Скачать все фотографии' }).click()
        expect((await download).suggestedFilename()).toBe('images.zip')
    })

    test('is not allowed to see history', async ({ page }) => {
        await page.goto('/history')
        await expect(page).toHaveURL(/\/api\/auth\/signin/)
    })
})
