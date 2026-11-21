import { expect, test } from '@playwright/test'

import { GEORGIA, description, imageId, labelId, lightbox, thumbnail } from './helpers'

test.describe('lightbox', () => {
    test('shows photo with its description', async ({ page }) => {
        const id = await imageId(GEORGIA, 'IMG_0001.jpg')
        await page.goto(GEORGIA)
        await thumbnail(page, id).click()

        await expect(lightbox(page)).toBeVisible()
        await expect(page).toHaveURL(new RegExp(`#view-\\d+-${id}$`))
        await expect(lightbox(page).locator('.yarl__slide_current img')).toHaveAttribute('src', `${GEORGIA}/IMG_0001.jpg`)
        await expect(description(page).locator('.title')).toHaveText('Вид на Омало')
        await expect(description(page).locator('.labels')).toHaveText('Горы, Омало')
        await expect(description(page).locator('.exif')).toHaveText('35mm, ISO 100, 1/250s, f/8')
    })

    test('navigates between photos', async ({ page }) => {
        const first = await imageId(GEORGIA, 'IMG_0001.jpg')
        const second = await imageId(GEORGIA, 'IMG_0002.jpg')
        await page.goto(`${GEORGIA}#view-0-${first}`)
        await expect(description(page).locator('.title')).toHaveText('Вид на Омало')

        await page.getByRole('button', { name: 'Next' }).click()
        await expect(page).toHaveURL(new RegExp(`#view-1-${second}$`))
        await expect(description(page).locator('.title')).toHaveText('Таня в горах')

        await page.getByRole('button', { name: 'Previous' }).click()
        await expect(page).toHaveURL(new RegExp(`#view-0-${first}$`))
    })

    test('opens from a link with photo index', async ({ page }) => {
        const id = await imageId(GEORGIA, 'IMG_0002.jpg')
        await page.goto(`${GEORGIA}#view-1-${id}`)
        await expect(lightbox(page)).toBeVisible()
        await expect(description(page).locator('.title')).toHaveText('Таня в горах')
    })

    test('closes with close button', async ({ page }) => {
        const id = await imageId(GEORGIA, 'IMG_0001.jpg')
        await page.goto(GEORGIA)
        await thumbnail(page, id).click()
        await expect(lightbox(page)).toBeVisible()

        await page.getByRole('button', { name: 'Close' }).click()
        await expect(lightbox(page)).toBeHidden()
        await expect(page).toHaveURL(GEORGIA)
    })

    test('closes with browser back button', async ({ page }) => {
        const id = await imageId(GEORGIA, 'IMG_0001.jpg')
        await page.goto(GEORGIA)
        await thumbnail(page, id).click()
        await expect(lightbox(page)).toBeVisible()

        await page.goBack()
        await expect(lightbox(page)).toBeHidden()
        await expect(page).toHaveURL(GEORGIA)
    })

    test('label link opens photos with that label', async ({ page }) => {
        const id = await imageId(GEORGIA, 'IMG_0001.jpg')
        const label = await labelId('Омало')
        await page.goto(`${GEORGIA}#view-0-${id}`)

        await description(page).getByRole('link', { name: 'Омало' }).click()
        await expect(page).toHaveURL(`/?-filt.labels=${label}&opener=${id}`)
        await expect(page).toHaveTitle('Фотографии с тегом Омало')
        await expect(thumbnail(page, id)).toBeVisible()
    })

    test('restricted photo asks anonymous visitor to sign in', async ({ page }) => {
        const id = await imageId(GEORGIA, 'IMG_0003.jpg')
        const misdirected: string[] = []
        page.on('request', request => {
            if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/'))
                misdirected.push(request.url())
        })
        await page.goto(GEORGIA)
        await thumbnail(page, id).click()
        await expect(page).toHaveURL(`/signin?callbackUrl=${encodeURIComponent(GEORGIA)}`)
        await expect(page.getByRole('button', { name: 'Войти через GitHub' })).toBeVisible()
        // Thumbnail logging (a server action) must not be posted to an auth route while the page is leaving
        expect(misdirected).toEqual([])
    })
})
