import { expect, test } from '@playwright/test'

import { GEORGIA, asAdmin, asImpostor, asUser, db, imageId } from './helpers'

test.describe('history', () => {
    test.use({ storageState: asAdmin })

    test('shows visitor activity to admin', async ({ page, browser }, testInfo) => {
        // Unique address per worker, so parallel tests do not see each other's views
        const ip = `10.0.${Math.floor(testInfo.workerIndex / 250)}.${testInfo.workerIndex % 250 + 1}`

        // Admin views are not logged
        await page.request.get(`${GEORGIA}/IMG_0001.jpg`, { headers: { 'x-real-ip': ip } })

        const visitor = await browser.newContext({ storageState: asUser, extraHTTPHeaders: { 'x-real-ip': ip } })
        try {
            const response = await visitor.request.get(`${GEORGIA}/IMG_0002.jpg`)
            expect(response.status()).toBe(200)
        } finally {
            await visitor.close()
        }

        // Log is written after the response is sent
        const entry = page.getByRole('link', { name: new RegExp(`^${ip.replaceAll('.', '\\.')}\\b`) })
        await expect(async () => {
            await page.goto('/history')
            await expect(entry).toBeVisible({ timeout: 1000 })
        }).toPass()
        await expect(entry).toHaveText(`${ip} - E2E User`)

        await entry.click()
        await expect(page).toHaveURL(new RegExp(`/history/${ip.replaceAll('.', '\\.')}/\\d{4}-\\d{2}-\\d{2}`))
        await expect(page.locator('h2')).toContainText('E2E User')
        await expect(page.locator(`a[href="${GEORGIA}/IMG_0002.jpg"]`)).toBeVisible()
        await expect(page.locator(`a[href="${GEORGIA}/IMG_0001.jpg"]`)).toHaveCount(0)
    })
})

test.describe('history pages', () => {
    test.use({ storageState: asAdmin })

    test('load older weeks while scrolling, beyond the last three months', async ({ page }, testInfo) => {
        // Unique address; entries older than other tests write, so they land on later pages
        const ip = `10.5.${Math.floor(testInfo.workerIndex / 250)}.${testInfo.workerIndex % 250 + 1}`
        const image = await imageId(GEORGIA, 'IMG_0001.jpg')
        const days = [1, 10, 40, 100].map(ago => new Date(Date.now() - ago * 24 * 60 * 60 * 1000))
        await db()`DELETE FROM log WHERE ip = ${ip}`
        for (const ctime of days)
            await db()`INSERT INTO log (image, ip, status, ctime) VALUES (${image}, ${ip}, 3, ${ctime})`
        try {
            const actions: string[] = []
            page.on('request', request => {
                if (request.headers()['next-action'])
                    actions.push(request.url())
            })
            await page.goto('/history')
            for (const day of days) {
                const link = page.locator(`a[href^="/history/${ip}/${day.toISOString().slice(0, 10)}"]`)
                await expect(async () => {
                    await page.mouse.wheel(0, 10000)
                    await expect(link).toHaveCount(1, { timeout: 500 })
                }).toPass()
            }
            // The first page holds the latest week, each older week came with its own request
            expect(actions.length).toBeGreaterThanOrEqual(3)
            // Malformed filters are ignored instead of failing in SQL
            const response = await page.goto('/history?-filt.status=abc&-filt.label=x&-filt.from=yesterday')
            expect(response?.status()).toBe(200)
        } finally {
            await db()`DELETE FROM log WHERE ip = ${ip}`
        }
    })
})

test.describe('visitor day page', () => {
    test.use({ storageState: asAdmin })

    test('filters by action, and reports malformed addresses and dates as not found', async ({ page }, testInfo) => {
        const ip = `10.6.${Math.floor(testInfo.workerIndex / 250)}.${testInfo.workerIndex % 250 + 1}`
        const original = await imageId(GEORGIA, 'IMG_0001.jpg')
        const viewed = await imageId(GEORGIA, 'IMG_0002.jpg')
        const now = new Date()
        const day = now.toISOString().slice(0, 10)
        await db()`DELETE FROM log WHERE ip = ${ip}`
        // ACTION_ORIGINAL and ACTION_VIEW
        await db()`INSERT INTO log (image, ip, status, ctime) VALUES (${original}, ${ip}, 0, ${now}), (${viewed}, ${ip}, 3, ${now})`
        try {
            const photo = (name: string) => page.locator(`a[href="${GEORGIA}/${name}"]`)

            await page.goto(`/history/${ip}/${day}`)
            await expect(photo('IMG_0001.jpg')).toBeVisible()
            await expect(photo('IMG_0002.jpg')).toBeVisible()

            // Status 0 used to be dropped as falsy
            await page.goto(`/history/${ip}/${day}?-filt.status=0`)
            await expect(photo('IMG_0001.jpg')).toBeVisible()
            await expect(photo('IMG_0002.jpg')).toHaveCount(0)

            // Malformed filters are ignored instead of failing in SQL
            const ignored = await page.goto(`/history/${ip}/${day}?-filt.status=abc&-filt.label=x`)
            expect(ignored?.status()).toBe(200)
            await expect(photo('IMG_0002.jpg')).toBeVisible()

            for (const path of [`/history/not-an-ip/${day}`, `/history/${ip}/2026-13-45`, `/history/${ip}/yesterday`, '/history/999.1.1.1'])
                expect((await page.goto(path))?.status(), path).toBe(404)
        } finally {
            await db()`DELETE FROM log WHERE ip = ${ip}`
        }
    })
})

test.describe('visitor with admin account id from another provider', () => {
    test.use({ storageState: asImpostor })

    test('is not an admin', async ({ page }, testInfo) => {
        await page.goto('/history')
        await expect(page).toHaveURL(/\/signin/)

        // Views are logged as for any other visitor
        const ip = `10.1.${Math.floor(testInfo.workerIndex / 250)}.${testInfo.workerIndex % 250 + 1}`
        const response = await page.request.get(`${GEORGIA}/IMG_0001.jpg`, { headers: { 'x-real-ip': ip } })
        expect(response.status()).toBe(200)
        await expect(async () => {
            const rows = await db()`SELECT 1 FROM log WHERE ip = ${ip} AND visitor_id = 'e2e-admin' AND visitor_provider = 'vk'`
            expect(rows).toHaveLength(1)
        }).toPass()
    })
})
