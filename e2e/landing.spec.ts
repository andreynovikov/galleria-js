import { expect, test, type Page } from '@playwright/test'

import { ARMENIA, FAMILY, GEORGIA, HIDDEN, asUser, db, labelId, thumbnail, thumbnails } from './helpers'

function tag(page: Page, name: string) {
    // Related labels are prefixed with "+"
    return page.locator('.tag-cloud-tag').filter({ hasText: new RegExp(`^\\+?${name}$`) })
}

test.describe('landing page', () => {
    test('shows random photos, albums and labels', async ({ page }) => {
        await page.goto('/')
        await expect(page).toHaveTitle('Альбомы и теги')

        const slide = page.locator('.swiper-slide img').first()
        await expect(slide).toBeVisible()
        await expect.poll(() => slide.evaluate((img: HTMLImageElement) => img.complete ? img.naturalWidth : 0)).toBeGreaterThan(0)

        // Censored photos are neither counted nor revealed by their album or labels
        for (const [bundle, count] of [[GEORGIA, 3], [ARMENIA, 1], [FAMILY, 1]] as const) {
            const link = page.getByRole('link', { name: bundle, exact: true })
            await expect(page.getByRole('listitem').filter({ has: link })).toContainText(`(${count})`)
        }
        await expect(page.getByRole('link', { name: HIDDEN, exact: true })).toHaveCount(0)

        for (const name of ['Горы', 'Омало', 'Таня', 'Private'])
            await expect(tag(page, name)).toBeVisible()
        await expect(tag(page, 'Скрытое')).toHaveCount(0)
    })

    test.describe('of visitor allowed by censorship level', () => {
        test.use({ storageState: asUser })

        test('counts censored photos', async ({ page }) => {
            await page.goto('/')
            for (const [bundle, count] of [[ARMENIA, 2], [HIDDEN, 1]] as const) {
                const link = page.getByRole('link', { name: bundle, exact: true })
                await expect(page.getByRole('listitem').filter({ has: link })).toContainText(`(${count})`)
            }
            await expect(tag(page, 'Скрытое')).toBeVisible()
        })
    })

    test('is in Russian and shows text before the font loads', async ({ page }) => {
        await page.goto('/')
        await expect(page.locator('html')).toHaveAttribute('lang', 'ru')
        // Not the fallback face next/font adds, which is a local font
        const displays = await page.evaluate(() => [...document.fonts]
            .filter(font => font.family.replace(/["']/g, '') === 'Nunito')
            .map(font => font.display))
        expect(displays.length).toBeGreaterThan(0)
        expect(new Set(displays)).toEqual(new Set(['swap']))
    })

    test('album link opens the album', async ({ page }) => {
        await page.goto('/')
        await page.getByRole('link', { name: GEORGIA, exact: true }).click()
        await expect(page).toHaveURL(GEORGIA)
        await expect(thumbnails(page)).toHaveCount(3)
    })

    test('random photo opens its album', async ({ page }) => {
        const censored = (await db()<{ id: number }[]>`SELECT id FROM image WHERE censored > 0`).map(row => row.id)

        await page.goto('/')
        const slides = page.locator('.swiper-slide a')
        await expect(slides.first()).toBeVisible()
        const hrefs = await slides.evaluateAll(links => links.map(link => link.getAttribute('href') ?? ''))
        const openers = hrefs.map(href => Number(new URL(href, 'http://localhost').searchParams.get('opener')))
        // Censored photos are not shown to anonymous visitors
        expect(openers.filter(id => censored.includes(id))).toEqual([])

        await slides.first().click()
        await expect(page).toHaveURL(hrefs[0])
        await expect(thumbnail(page, openers[0])).toBeVisible()
    })

    test('label cloud builds a label filter', async ({ page }) => {
        const mountains = await labelId('Горы')

        await page.goto('/')
        await tag(page, 'Горы').click()
        await expect(tag(page, 'Горы')).toHaveClass(/selected/)
        // Labels of photos which also have the selected label
        await expect(tag(page, 'Омало')).toHaveClass(/related/)
        await expect(tag(page, 'Таня')).toHaveClass(/related/)
        await expect(tag(page, 'Private')).not.toHaveClass(/related/)

        await page.getByRole('button', { name: 'Показать' }).click()
        await expect(page).toHaveURL(`/?-filt.labels=${mountains}`)
        await expect(page).toHaveTitle('Фотографии с тегом Горы')
        await expect(thumbnails(page)).toHaveCount(3)
    })

    test('clicking a selected label again excludes it', async ({ page }) => {
        const mountains = await labelId('Горы')
        const tanya = await labelId('Таня')

        await page.goto('/')
        const actions: string[] = []
        page.on('request', request => {
            if (request.headers()['next-action'])
                actions.push(request.url())
        })
        await tag(page, 'Горы').click()
        await tag(page, 'Таня').click()
        await tag(page, 'Таня').click()
        await expect(tag(page, 'Таня')).toHaveClass(/excluded/)
        // Photos with Горы and without Таня
        await expect(tag(page, 'Омало')).toHaveClass(/related/)
        // Related labels are asked for once clicks pause, not on every click (and not on load)
        expect(actions.length).toBeLessThanOrEqual(2)

        await page.getByRole('button', { name: 'Показать' }).click()
        await expect(page).toHaveURL(`/?-filt.labels=${mountains}&-filt.notlabels=${tanya}`)
        await expect(thumbnails(page)).toHaveCount(2)
    })
})
