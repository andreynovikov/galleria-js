import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, test, type APIRequestContext } from '@playwright/test'
import sharp from 'sharp'

import { fixturesFolder } from './env'
import { ARMENIA, FAMILY, GEORGIA, asUser, imageId } from './helpers'

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

test.describe('album download', () => {
    test('redirects anonymous visitor to sign in', async ({ request }) => {
        const response = await request.get('/download?images=1', { maxRedirects: 0 })
        expect(response.status()).toBe(307)
        expect(response.headers()['location']).toContain('/signin')
    })

    test('returns zip archive of photos', async ({ browser }) => {
        const ids = [await imageId(ARMENIA, 'IMG_0101.jpg'), await imageId(ARMENIA, 'IMG_0102.jpg')]
        const context = await browser.newContext({ storageState: asUser })
        try {
            const response = await context.request.get(`/download?images=${ids.join()}`)
            expect(response.status()).toBe(200)
            expect(response.headers()['content-disposition']).toBe('attachment; filename=images.zip')
            const body = await response.body()
            expect(body.subarray(0, 4).toString('latin1')).toBe('PK\x03\x04')
            expect(body.includes('IMG_0101.jpg')).toBe(true)
            expect(body.includes('IMG_0102.jpg')).toBe(true)
        } finally {
            await context.close()
        }
    })
})
