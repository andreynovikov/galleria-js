import { createHash } from 'node:crypto'

import { expect, test, type Page, type TestInfo } from '@playwright/test'

import { photosFolder } from './env'
import { ARMENIA, GEORGIA, asUser, db, description, imageId, lightbox, thumbnail, thumbnails } from './helpers'

/** Sends requests from an IP unique to the test, so its log rows can be told apart from parallel tests */
async function uniqueIp(page: Page, testInfo: TestInfo) {
    const hash = createHash('sha1').update(`${testInfo.testId}-${testInfo.retry}`).digest()
    const ip = `10.2.${hash[0]}.${hash[1]}`
    await page.setExtraHTTPHeaders({ 'x-real-ip': ip })
    return ip
}

async function logRows(ip: string) {
    return await db()<{ image: number, status: number, visitor_id: string | null, meta: { zoom?: number } | null }[]>`
      SELECT image, status, visitor_id, meta FROM log
      WHERE ip = ${ip}
      ORDER BY ctime
    `
}

test.describe('logging', () => {
    test('logs thumbnail view once, from the image route', async ({ page }, testInfo) => {
        const ip = await uniqueIp(page, testInfo)
        const id = await imageId(ARMENIA, 'IMG_0101.jpg')
        await page.goto(ARMENIA)
        await expect(thumbnails(page)).toHaveCount(1)
        await expect.poll(async () => (await logRows(ip)).length).toBe(1)
        // The page used to log every loaded thumbnail once more with a server action
        await page.waitForTimeout(1000)
        expect((await logRows(ip)).map(row => [row.image, row.status])).toEqual([[id, 6]])
    })

    test.describe('of signed-in visitor', () => {
        test.use({ storageState: asUser })

        test('logs lightbox view and zoom with the visitor and IP of the request', async ({ page }, testInfo) => {
            const ip = await uniqueIp(page, testInfo)
            const id = await imageId(GEORGIA, 'IMG_0001.jpg')
            await page.goto(GEORGIA)
            await thumbnail(page, id).click()
            await expect(lightbox(page)).toBeVisible()
            await expect.poll(async () => (await logRows(ip)).filter(row => row.status === 4)).toEqual([
                expect.objectContaining({ image: id, visitor_id: 'e2e-user' })
            ])

            await page.getByRole('button', { name: 'Zoom in' }).click()
            // Zoom is logged after it settles for a second
            await expect.poll(async () => (await logRows(ip)).filter(row => row.status === 2), { timeout: 5000 }).toEqual([
                expect.objectContaining({ image: id, visitor_id: 'e2e-user', meta: expect.objectContaining({ zoom: expect.any(Number) }) })
            ])
        })

        test('sees description of restricted photo', async ({ page }) => {
            const id = await imageId(GEORGIA, 'IMG_0003.jpg')
            await page.goto(`${GEORGIA}#view-2-${id}`)
            await expect(description(page).locator('.labels')).toContainText('Private')
        })
    })
})

test.describe('lightbox description', () => {
    test('is empty for restricted photo opened by anonymous visitor from a link', async ({ page }) => {
        const id = await imageId(GEORGIA, 'IMG_0003.jpg')
        await page.goto(`${GEORGIA}#view-2-${id}`)
        await expect(lightbox(page)).toBeVisible()
        // Loaded and empty: the loading indicator is gone and no labels are shown
        await expect(description(page).locator('*')).toHaveCount(0)
    })

    test('sends only the displayed fields', async ({ page }) => {
        const responses: Promise<string>[] = []
        page.on('response', response => {
            if (response.request().method() === 'POST')
                responses.push(response.text().catch(() => ''))
        })
        const id = await imageId(GEORGIA, 'IMG_0001.jpg')
        await page.goto(`${GEORGIA}#view-0-${id}`)
        await expect(description(page).locator('.title')).toHaveText('Вид на Омало')
        // Response events can reach the test after the page has rendered the description. Server action
        // responses have no charset and Playwright mis-decodes Cyrillic, so only ASCII is matched.
        const bodies = async () => (await Promise.all(responses)).join('\n')
        await expect.poll(bodies).toContain('"FNumber":8')
        const body = await bodies()
        expect(body).not.toContain(photosFolder)
        expect(body).not.toContain('Keywords')
    })
})
