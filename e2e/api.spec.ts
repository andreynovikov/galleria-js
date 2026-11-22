import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, test, type APIRequestContext } from '@playwright/test'
import sharp from 'sharp'

import { fixturesFolder, photosFolder } from './env'
import { ARMENIA, FAMILY, GEORGIA, asAdmin, asUser, asViewer, db, imageId } from './helpers'

async function image(request: APIRequestContext, url: string, type = 'image/jpeg') {
    const response = await request.get(url)
    expect(response.status(), url).toBe(200)
    expect(response.headers()['content-type']).toBe(type)
    const body = await response.body()
    return { body, ...await sharp(body).metadata() }
}

test.describe('image URLs', () => {
    test('serve screen-size image by default', async ({ request }) => {
        const { width, height } = await image(request, `${GEORGIA}/IMG_0001.jpg`)
        expect(width).toBe(1200)
        expect(height).toBe(800)
    })

    test('serve rotated screen-size image of photo with EXIF orientation', async ({ request }) => {
        const { width, height } = await image(request, `${FAMILY}/DSC_0001.jpg`)
        expect(width).toBe(800)
        expect(height).toBe(1200)
    })

    test('serve original file', async ({ request }) => {
        const { body } = await image(request, `${GEORGIA}/IMG_0001.jpg?format=original`)
        expect(body.equals(await readFile(join(fixturesFolder, 'photos', GEORGIA, 'IMG_0001.jpg')))).toBe(true)
    })

    test('serve export-size image', async ({ request }) => {
        const { width } = await image(request, `${GEORGIA}/IMG_0001.jpg?format=export`)
        expect(width).toBe(600)
    })

    test('serve thumbnails', async ({ request }) => {
        const small = await image(request, `${GEORGIA}/IMG_0001.jpg?format=thumbnail&size=s`, 'image/webp')
        expect(small.format).toBe('webp')
        expect(small.width).toBe(150)

        const vertical = await image(request, `${GEORGIA}/IMG_0002.jpg?format=thumbnail&size=l&constraint=vertical`, 'image/webp')
        expect(vertical.height).toBe(450)

        const fallback = await image(request, `${GEORGIA}/IMG_0001.jpg?format=thumbnail&size=unknown`, 'image/webp')
        expect(fallback.width).toBe(300)

        // Cached thumbnail is served on the second request
        const cached = await image(request, `${GEORGIA}/IMG_0001.jpg?format=thumbnail&size=s`, 'image/webp')
        expect(cached.body.equals(small.body)).toBe(true)
    })

    test('regenerate thumbnail on force only for admin', async ({ request, browser }) => {
        // A size no other test requests, so rewriting it does not affect them
        const url = `${GEORGIA}/IMG_0001.jpg?format=thumbnail&size=s&constraint=vertical&force=1`
        const file = join(photosFolder, GEORGIA, 'thumbs', 'ts-IMG_0001.jpg-vertical.webp')
        await image(request, url, 'image/webp')
        const created = (await stat(file)).mtimeMs
        const etag = (await request.get(url)).headers()['etag']

        await image(request, url, 'image/webp')
        expect((await stat(file)).mtimeMs).toBe(created)

        const context = await browser.newContext({ storageState: asAdmin })
        try {
            await image(context.request, url, 'image/webp')
            expect((await stat(file)).mtimeMs).toBeGreaterThan(created)
            // Browsers see the regenerated thumbnail as changed
            expect((await request.get(url)).headers()['etag']).not.toBe(etag)
        } finally {
            await context.close()
        }
    })

    test('serve screen image scaled by ratio', async ({ request }) => {
        const { width } = await image(request, `${GEORGIA}/IMG_0001.jpg?ratio=0.5`)
        expect(width).toBe(600)
    })

    test('log every request of resized images, also served from memory', async ({ request }, testInfo) => {
        // An IP and a ratio unique to this test, so its log rows are its own and its versions are not cached yet
        const hash = createHash('sha1').update(`${testInfo.testId}-${testInfo.retry}`).digest()
        const ip = `10.3.${hash[0]}.${hash[1]}`
        // ACTION_VIEW, and ACTION_LOCKED for the restricted photo
        const photos = [['IMG_0001.jpg', 3], ['IMG_0003.jpg', 7]] as const
        const expected: [number, number][] = []
        for (const [name, action] of photos) {
            const url = `${GEORGIA}/${name}?ratio=0.35`
            const first = await request.get(url, { headers: { 'x-real-ip': ip } })
            const second = await request.get(url, { headers: { 'x-real-ip': ip } })
            expect(first.status(), name).toBe(200)
            expect(second.status(), name).toBe(200)
            expect((await second.body()).equals(await first.body()), name).toBe(true)
            const id = await imageId(GEORGIA, name)
            expected.push([id, action], [id, action])
        }
        await expect.poll(async () => {
            const rows = await db()<{ image: number, status: number }[]>`SELECT image, status FROM log WHERE ip = ${ip}`
            return rows.map(row => [row.image, row.status]).sort()
        }).toEqual(expected.sort())
    })

    test('reject invalid ratio', async ({ request }) => {
        for (const ratio of ['0', '-1', '2', 'abc', 'Infinity', '']) {
            const response = await request.get(`${GEORGIA}/IMG_0001.jpg?ratio=${ratio}`)
            expect(response.status(), ratio).toBe(400)
        }
    })

    test('return 404 for missing file', async ({ request }) => {
        for (const query of ['', '?format=original', '?format=thumbnail&size=s']) {
            const response = await request.get(`${GEORGIA}/IMG_9999.jpg${query}`)
            expect(response.status(), query).toBe(404)
        }
    })

    test.describe('of restricted photo', () => {
        const url = `${GEORGIA}/IMG_0003.jpg`

        test('forbid original for anonymous visitor', async ({ request }) => {
            const response = await request.get(`${url}?format=original`)
            expect(response.status()).toBe(403)
        })

        test('serve locked images to anonymous visitor', async ({ request, browser }) => {
            const context = await browser.newContext({ storageState: asUser })
            try {
                const anonymous = await image(request, `${url}?format=thumbnail&size=s`, 'image/webp')
                const user = await image(context.request, `${url}?format=thumbnail&size=s`, 'image/webp')
                expect(anonymous.width).toBe(user.width)
                expect(anonymous.body.equals(user.body)).toBe(false)

                const lockedScreen = await image(request, url)
                const screen = await image(context.request, url)
                expect(lockedScreen.width).toBe(1200)
                expect(lockedScreen.body.equals(screen.body)).toBe(false)

                const original = await context.request.get(`${url}?format=original`)
                expect(original.status()).toBe(200)
            } finally {
                await context.close()
            }
        })

        test('is not cached by shared caches or across sign-in', async ({ request, browser }) => {
            const context = await browser.newContext({ storageState: asUser })
            try {
                for (const client of [request, context.request]) {
                    for (const query of ['', '?format=thumbnail&size=s']) {
                        const response = await client.get(`${url}${query}`)
                        expect(response.status(), query).toBe(200)
                        expect(response.headers()['cache-control'], query).toBe('private, no-cache')
                        expect(response.headers()['vary'], query).toContain('Cookie')
                    }
                }
            } finally {
                await context.close()
            }
        })
    })

    test('of other photos do not depend on visitor', async ({ request }) => {
        const response = await request.get(`${GEORGIA}/IMG_0001.jpg?format=thumbnail&size=s`)
        expect(response.status()).toBe(200)
        expect(response.headers()['cache-control']).toBe('public, max-age=3600')
        expect(response.headers()['vary'] ?? '').not.toContain('Cookie')
    })

    test('answer conditional requests', async ({ request }) => {
        const url = `${GEORGIA}/IMG_0001.jpg`
        const etags = new Set<string>()
        for (const query of ['', '?format=original', '?format=export', '?ratio=0.25', '?format=thumbnail&size=s', '?format=thumbnail&size=m']) {
            const response = await request.get(`${url}${query}`)
            expect(response.status(), query).toBe(200)
            const etag = response.headers()['etag']
            expect(etag, query).toMatch(/^W\/".+"$/)
            etags.add(etag)

            const cached = await request.get(`${url}${query}`, { headers: { 'if-none-match': etag } })
            expect(cached.status(), query).toBe(304)
            expect(cached.headers()['etag'], query).toBe(etag)
            expect(cached.headers()['cache-control'], query).toBe('public, max-age=3600')
            expect((await cached.body()).length, query).toBe(0)

            const changed = await request.get(`${url}${query}`, { headers: { 'if-none-match': 'W/"other"' } })
            expect(changed.status(), query).toBe(200)
        }
        // Every variant has its own validator
        expect(etags.size).toBe(6)
    })

    test('of restricted photo are revalidated after signing in', async ({ request, browser }) => {
        const url = `${GEORGIA}/IMG_0003.jpg?format=thumbnail&size=s`
        const locked = (await request.get(url)).headers()['etag']
        const context = await browser.newContext({ storageState: asUser })
        try {
            const response = await context.request.get(url, { headers: { 'if-none-match': locked } })
            expect(response.status()).toBe(200)
            expect(response.headers()['etag']).not.toBe(locked)
        } finally {
            await context.close()
        }
    })
})

test('security headers are sent', async ({ request }) => {
    for (const url of ['/', GEORGIA, `${GEORGIA}/IMG_0001.jpg`]) {
        const headers = (await request.get(url)).headers()
        expect(headers['content-security-policy'], url).toContain("frame-ancestors 'self'")
        expect(headers['content-security-policy'], url).toContain("object-src 'none'")
        expect(headers['content-security-policy'], url).not.toContain('unsafe-eval')
        expect(headers['x-frame-options'], url).toBe('SAMEORIGIN')
        expect(headers['referrer-policy'], url).toBe('strict-origin-when-cross-origin')
        expect(headers['x-content-type-options'], url).toBe('nosniff')
    }
})

test.describe('censored photo', () => {
    const url = `${ARMENIA}/IMG_0102.jpg`
    const formats = ['', '?format=original', '?format=export', '?format=thumbnail&size=s']

    test('is reported as missing to anonymous visitor', async ({ request }) => {
        for (const query of formats) {
            const response = await request.get(`${url}${query}`)
            expect(response.status(), query).toBe(404)
        }
    })

    test('is reported as missing to visitor without censorship level', async ({ browser }) => {
        const context = await browser.newContext({ storageState: asViewer })
        try {
            for (const query of formats) {
                const response = await context.request.get(`${url}${query}`)
                expect(response.status(), query).toBe(404)
            }
        } finally {
            await context.close()
        }
    })

    test('is served to visitor allowed by censorship level', async ({ browser }) => {
        const context = await browser.newContext({ storageState: asUser })
        try {
            for (const query of formats) {
                const response = await context.request.get(`${url}${query}`)
                expect(response.status(), query).toBe(200)
                expect(response.headers()['cache-control'], query).toBe('private, no-cache')
                expect(response.headers()['vary'], query).toContain('Cookie')
            }
        } finally {
            await context.close()
        }
    })
})

test.describe('album download', () => {
    test('redirects anonymous visitor to sign in', async ({ request }) => {
        const response = await request.get('/download?images=1,2', { maxRedirects: 0 })
        expect(response.status()).toBe(307)
        const location = new URL(response.headers()['location'])
        expect(location.pathname).toBe('/signin')
        const callbackUrl = new URL(location.searchParams.get('callbackUrl') ?? '', location)
        expect(callbackUrl.pathname).toBe('/download')
        expect(callbackUrl.searchParams.get('images')).toBe('1,2')
    })

    test('returns zip archive of photos', async ({ browser }) => {
        const ids = [await imageId(ARMENIA, 'IMG_0101.jpg'), await imageId(ARMENIA, 'IMG_0102.jpg')]
        const context = await browser.newContext({ storageState: asUser })
        try {
            const response = await context.request.get(`/download?images=${ids.join()}`)
            expect(response.status()).toBe(200)
            expect(response.headers()['content-disposition']).toBe('attachment; filename=images.zip')
            expect(response.headers()['content-type']).toBe('application/zip')
            const body = await response.body()
            expect(body.subarray(0, 4).toString('latin1')).toBe('PK\x03\x04')
            expect(body.includes('IMG_0101.jpg')).toBe(true)
            expect(body.includes('IMG_0102.jpg')).toBe(true)
        } finally {
            await context.close()
        }
    })

    test('rejects too many photos', async ({ browser }) => {
        const context = await browser.newContext({ storageState: asUser })
        try {
            const ids = Array.from({ length: 1001 }, (_, i) => i + 1)
            const response = await context.request.get(`/download?images=${ids.join()}`)
            expect(response.status()).toBe(400)

            // Repeated ids are counted once
            const id = await imageId(ARMENIA, 'IMG_0101.jpg')
            const repeated = await context.request.get(`/download?images=${Array(1001).fill(id).join()}`)
            expect(repeated.status()).toBe(200)
            const body = await repeated.body()
            // Zip archive has each name twice: in the entry header and in the central directory
            expect(body.toString('latin1').split('IMG_0101.jpg').length - 1).toBe(2)
        } finally {
            await context.close()
        }
    })

    test('skips censored and missing photos', async ({ browser }) => {
        const ids = [await imageId(ARMENIA, 'IMG_0101.jpg'), await imageId(ARMENIA, 'IMG_0102.jpg'), 999999]
        const context = await browser.newContext({ storageState: asViewer })
        try {
            const response = await context.request.get(`/download?images=${ids.join()}`)
            expect(response.status()).toBe(200)
            const body = await response.body()
            expect(body.includes('IMG_0101.jpg')).toBe(true)
            expect(body.includes('IMG_0102.jpg')).toBe(false)
        } finally {
            await context.close()
        }
    })
})
