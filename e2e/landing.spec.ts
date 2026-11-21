import { expect, test, type Page } from '@playwright/test'

import { ARMENIA, FAMILY, GEORGIA, db, labelId, thumbnail, thumbnails } from './helpers'

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

        for (const [bundle, count] of [[GEORGIA, 3], [ARMENIA, 2], [FAMILY, 1]] as const) {
            const link = page.getByRole('link', { name: bundle, exact: true })
            await expect(page.getByRole('listitem').filter({ has: link })).toContainText(`(${count})`)
        }

        for (const name of ['Горы', 'Омало', 'Таня', 'Private'])
            await expect(tag(page, name)).toBeVisible()
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
        await tag(page, 'Горы').click()
        await tag(page, 'Таня').click()
        await tag(page, 'Таня').click()
        await expect(tag(page, 'Таня')).toHaveClass(/excluded/)

        await page.getByRole('button', { name: 'Показать' }).click()
        await expect(page).toHaveURL(`/?-filt.labels=${mountains}&-filt.notlabels=${tanya}`)
        await expect(thumbnails(page)).toHaveCount(2)
    })
})
