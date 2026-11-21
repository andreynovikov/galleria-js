import { expect, test, type Page } from '@playwright/test'

import { ARMENIA, FAMILY, GEORGIA, labelId, thumbnail, thumbnails } from './helpers'

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
        await page.goto('/')
        const link = page.locator('.swiper-slide a').first()
        const href = await link.getAttribute('href') ?? ''
        const opener = Number(new URL(href, 'http://localhost').searchParams.get('opener'))
        await link.click()
        await expect(page).toHaveURL(href)
        await expect(thumbnail(page, opener)).toBeVisible()
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
