import { expect, test } from '@playwright/test'

import { ARMENIA, FAMILY, GEORGIA, imageId, lightbox, thumbnail, thumbnails } from './helpers'

test.describe('gallery', () => {
    test('shows photos of an album', async ({ page }) => {
        await page.goto(GEORGIA)
        await expect(page).toHaveTitle('Фотографии из travel/Georgia/2015')
        await expect(thumbnails(page)).toHaveCount(3)
        for (const name of ['IMG_0001.jpg', 'IMG_0002.jpg', 'IMG_0003.jpg'])
            await expect(thumbnail(page, await imageId(GEORGIA, name))).toBeVisible()

        const image = thumbnails(page).first().locator('img')
        await expect(image).toHaveAttribute('src', /format=thumbnail/)
        await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete ? img.naturalWidth : 0)).toBeGreaterThan(0)
    })

    test('orders photos as asked, by shooting time when the order is unknown', async ({ page }) => {
        // The lightbox opens the photo at an index of the list, so its first slide is the first photo in the order
        const first = async (query: string) => {
            await page.goto(`${GEORGIA}${query}#view-0-0`)
            await expect(lightbox(page)).toBeVisible()
            const src = await lightbox(page).locator('.yarl__slide_current img').getAttribute('src')
            return src?.split('/').at(-1)
        }
        expect(await first('')).toBe('IMG_0001.jpg')
        expect(await first('?-nav.order=-stime')).toBe('IMG_0003.jpg')
        expect(await first('?-nav.order=-name')).toBe('IMG_0003.jpg')
        expect(await first('?-nav.order=ctime')).toBe('IMG_0001.jpg')
        // Other columns and unknown names used to be passed to ORDER BY and fail with 500
        for (const order of ['-censored', 'nonexistent', '-'])
            expect(await first(`?-nav.order=${order}`), order).toBe('IMG_0001.jpg')
    })

    test('loads thumbnails lazily and fades them in', async ({ page }) => {
        await page.goto(GEORGIA)
        const images = thumbnails(page).locator('img')
        await expect(images).toHaveCount(3)
        for (const image of await images.all()) {
            await expect(image).toHaveAttribute('loading', 'lazy')
            await expect(image).toHaveClass(/\blazyloaded\b/)
        }
    })

    test('lays out photos by their orientation', async ({ page }) => {
        await page.goto(FAMILY)
        // The file is stored as landscape with EXIF orientation 6
        const box = await thumbnails(page).first().boundingBox()
        expect(box).not.toBeNull()
        expect(box!.height).toBeGreaterThan(box!.width)
    })

    test('links back to all albums', async ({ page }) => {
        await page.goto(GEORGIA)
        await page.getByRole('link', { name: 'Все альбомы' }).click()
        await expect(page).toHaveURL('/')
        await expect(page).toHaveTitle('Альбомы и теги')
    })

    test('hides censored photos from anonymous visitors', async ({ page }) => {
        await page.goto(ARMENIA)
        await expect(thumbnails(page)).toHaveCount(1)
        await expect(thumbnail(page, await imageId(ARMENIA, 'IMG_0101.jpg'))).toBeVisible()
    })

    test('censorship filter can not show censored photos to anonymous visitors', async ({ page }) => {
        await page.goto(`${ARMENIA}?-filt.censored=9`)
        await expect(thumbnails(page)).toHaveCount(1)
        await expect(thumbnail(page, await imageId(ARMENIA, 'IMG_0101.jpg'))).toBeVisible()
    })

    test('filters all photos by label name', async ({ page }) => {
        await page.goto('/?-filt.labels=Таня')
        await expect(page).toHaveTitle('Фотографии с тегом Таня')
        await expect(thumbnails(page)).toHaveCount(3)
        for (const [bundle, name] of [[GEORGIA, 'IMG_0002.jpg'], [GEORGIA, 'IMG_0003.jpg'], [FAMILY, 'DSC_0001.jpg']])
            await expect(thumbnail(page, await imageId(bundle, name))).toBeVisible()
    })

    test('requires all filtered labels', async ({ page }) => {
        await page.goto('/?-filt.labels=Горы,Таня')
        await expect(page).toHaveTitle('Фотографии с тегами Горы, Таня')
        await expect(thumbnails(page)).toHaveCount(1)
        await expect(thumbnail(page, await imageId(GEORGIA, 'IMG_0002.jpg'))).toBeVisible()
    })

    test('filters album by shooting time', async ({ page }) => {
        await page.goto(`${GEORGIA}?-filt.from=2015-06-26&-filt.till=2015-06-27`)
        await expect(page).toHaveTitle(/^Фотографии из travel\/Georgia\/2015 после .+ до .+$/)
        await expect(thumbnails(page)).toHaveCount(1)
        await expect(thumbnail(page, await imageId(GEORGIA, 'IMG_0002.jpg'))).toBeVisible()
    })

    test('shows placeholder when nothing is found', async ({ page }) => {
        await page.goto('/?-filt.labels=Несуществующий')
        await expect(page.getByRole('img', { name: 'Nothing found' })).toBeVisible()
        await expect(thumbnails(page)).toHaveCount(0)
    })

    test('returns 404 for missing album', async ({ page }) => {
        const response = await page.goto('/no/such/album')
        expect(response?.status()).toBe(404)
    })

    test('returns 404 for thumbnails folder', async ({ page }) => {
        const response = await page.goto(`${GEORGIA}/thumbs`)
        expect(response?.status()).toBe(404)
    })
})

test('pages work under the content security policy', async ({ page }) => {
    const violations: string[] = []
    page.on('console', message => {
        if (message.text().includes('Content Security Policy'))
            violations.push(message.text())
    })
    await page.goto('/')
    await expect(page.locator('.swiper-slide img').first()).toBeVisible()
    await page.goto(GEORGIA)
    await thumbnail(page, await imageId(GEORGIA, 'IMG_0001.jpg')).click()
    await expect(page.locator('.yarl__slide_current img')).toBeVisible()
    await page.goto('/signin')
    await expect(page.getByRole('button', { name: 'Войти через GitHub' })).toBeVisible()
    expect(violations).toEqual([])
})

