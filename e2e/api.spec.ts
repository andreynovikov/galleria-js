import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, test, type APIRequestContext } from '@playwright/test'
import sharp from 'sharp'

import { fixturesFolder, photosFolder } from './env'
import { ARMENIA, FAMILY, GEORGIA, asAdmin, asUser, asViewer, imageId } from './helpers'

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

        await image(request, url, 'image/webp')
        expect((await stat(file)).mtimeMs).toBe(created)

        const context = await browser.newContext({ storageState: asAdmin })
        try {
            await image(context.request, url, 'image/webp')
            expect((await stat(file)).mtimeMs).toBeGreaterThan(created)
        } finally {
            await context.close()
        }
    })

    test('serve screen image scaled by ratio', async ({ request }) => {
        const { width } = await image(request, `${GEORGIA}/IMG_0001.jpg?ratio=0.5`)
        expect(width).toBe(600)
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
    })
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
