import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
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
    expect(body.length, url).toBeGreaterThan(0)
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
        // Files sent as they are have strong validators, which If-Range needs; resized versions have weak ones
        const files = ['?format=original', '?format=thumbnail&size=s', '?format=thumbnail&size=m']
        for (const query of ['', '?format=original', '?format=export', '?ratio=0.25', '?format=thumbnail&size=s', '?format=thumbnail&size=m']) {
            const response = await request.get(`${url}${query}`)
            expect(response.status(), query).toBe(200)
            const etag = response.headers()['etag']
            expect(etag, query).toMatch(files.includes(query) ? /^".+"$/ : /^W\/".+"$/)
            expect(response.headers()['accept-ranges'], query).toBe(files.includes(query) ? 'bytes' : undefined)
            expect(response.headers()['last-modified'] !== undefined, query).toBe(files.includes(query))
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

    test('resume downloads of originals with ranges', async ({ request }, testInfo) => {
        const hash = createHash('sha1').update(`${testInfo.testId}-${testInfo.retry}`).digest()
        const ip = `10.7.${hash[0]}.${hash[1]}`
        const url = `${GEORGIA}/IMG_0001.jpg?format=original`
        const file = await readFile(join(fixturesFolder, 'photos', GEORGIA, 'IMG_0001.jpg'))
        const size = file.length
        const full = await request.get(url)
        const { etag, 'last-modified': modified } = full.headers()
        const get = (headers: Record<string, string>) => request.get(url, { headers: { 'x-real-ip': ip, ...headers } })

        const first = await get({ range: 'bytes=0-99' })
        expect(first.status()).toBe(206)
        expect(first.headers()['content-range']).toBe(`bytes 0-99/${size}`)
        expect((await first.body()).equals(file.subarray(0, 100))).toBe(true)

        const rest = await get({ range: 'bytes=100-', 'if-range': etag })
        expect(rest.status()).toBe(206)
        expect(rest.headers()['content-range']).toBe(`bytes 100-${size - 1}/${size}`)
        expect(Buffer.concat([await first.body(), await rest.body()]).equals(file)).toBe(true)

        const last = await get({ range: 'bytes=-50', 'if-range': modified })
        expect(last.status()).toBe(206)
        expect((await last.body()).equals(file.subarray(size - 50))).toBe(true)

        // A file changed since (another validator) and several ranges get the whole file
        const wholeFile: Record<string, string>[] = [
            { range: 'bytes=100-', 'if-range': '"other"' },
            { range: 'bytes=100-', 'if-range': `W/${etag}` },
            { range: 'bytes=0-1,5-6' },
            { range: 'pages=1' }
        ]
        for (const headers of wholeFile) {
            const response = await get(headers)
            expect(response.status(), JSON.stringify(headers)).toBe(200)
            expect((await response.body()).length, JSON.stringify(headers)).toBe(size)
        }

        const beyond = await get({ range: `bytes=${size}-` })
        expect(beyond.status()).toBe(416)
        expect(beyond.headers()['content-range']).toBe(`bytes */${size}`)

        // Revalidation by date, when there is no ETag to compare
        expect((await get({ 'if-modified-since': modified })).status()).toBe(304)
        expect((await get({ 'if-modified-since': new Date(Date.parse(modified) - 1000).toUTCString() })).status()).toBe(200)

        // One download in parts is logged once, by its first part: here bytes=0-99, but not the parts from byte 100
        // and the last 50 bytes, or the range beyond the end. The four whole files, the 304 and the 200 are logged.
        await expect.poll(async () => (await db()<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM log WHERE ip = ${ip}`)[0].n).toBe(7)
    })

    test('of restricted photo have no modification date to revalidate by', async ({ browser }) => {
        // Locked and unlocked versions share it, so only the ETag tells them apart
        const context = await browser.newContext({ storageState: asUser })
        try {
            for (const query of ['?format=original', '?format=thumbnail&size=s', '']) {
                const response = await context.request.get(`${GEORGIA}/IMG_0003.jpg${query}`)
                expect(response.status(), query).toBe(200)
                expect(response.headers()['last-modified'], query).toBeUndefined()
            }
        } finally {
            await context.close()
        }
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

/** Entries of a zip archive, read from its central directory */
function unzip(body: Buffer) {
    const end = body.lastIndexOf(Buffer.from('PK\x05\x06', 'latin1'))
    expect(end, 'end of central directory').toBeGreaterThanOrEqual(0)
    const count = body.readUInt16LE(end + 10)
    let offset = body.readUInt32LE(end + 16)
    const entries: { name: string, method: number, data: Buffer }[] = []
    for (let i = 0; i < count; i++) {
        expect(body.readUInt32LE(offset), 'central directory header').toBe(0x02014b50)
        const method = body.readUInt16LE(offset + 10)
        const size = body.readUInt32LE(offset + 20)
        const nameLength = body.readUInt16LE(offset + 28)
        const header = body.readUInt32LE(offset + 42)
        const name = body.toString('utf8', offset + 46, offset + 46 + nameLength)
        offset += 46 + nameLength + body.readUInt16LE(offset + 30) + body.readUInt16LE(offset + 32)

        expect(body.readUInt32LE(header), 'local file header').toBe(0x04034b50)
        const start = header + 30 + body.readUInt16LE(header + 26) + body.readUInt16LE(header + 28)
        entries.push({ name, method, data: body.subarray(start, start + size) })
    }
    return entries
}

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
            // Named after the album
            expect(response.headers()['content-disposition'])
                .toBe(`attachment; filename="travel-Armenia-2016.zip"; filename*=UTF-8''travel-Armenia-2016.zip`)
            expect(response.headers()['content-type']).toBe('application/zip')
            const entries = unzip(await response.body())
            expect(entries.map(entry => entry.name)).toEqual(['IMG_0101.jpg', 'IMG_0102.jpg'])
            for (const entry of entries) {
                // Stored as is, JPEG doesn't compress
                expect(entry.method, entry.name).toBe(0)
                const { format, width } = await sharp(entry.data).metadata()
                expect(format, entry.name).toBe('jpeg')
                expect(width, entry.name).toBe(1200)
            }
        } finally {
            await context.close()
        }
    })

    test('puts photos with the same name in album folders and names the archive after the albums', async ({ browser, request }, testInfo) => {
        // Unique album with a copy of a photo without labels, under a name the Armenia album has too
        const name = `Копия(${testInfo.project.name}-${testInfo.repeatEachIndex})`
        const bundle = `/${name}`
        const folder = join(photosFolder, bundle)
        const copy = join(folder, 'img_0102.jpg')
        await rm(folder, { recursive: true, force: true })
        await mkdir(folder)
        const context = await browser.newContext({ storageState: asUser })
        try {
            await writeFile(copy, await readFile(join(fixturesFolder, 'photos', ARMENIA, 'IMG_0102.jpg')))
            expect((await request.get(encodeURI(bundle))).status()).toBe(200)
            const ids = [await imageId(ARMENIA, 'IMG_0101.jpg'), await imageId(ARMENIA, 'IMG_0102.jpg'), await imageId(bundle, 'img_0102.jpg')]

            // Names which differ only in case collide on Windows and macOS too
            const mixed = await context.request.get(`/download?images=${ids.join()}`)
            expect(mixed.status()).toBe(200)
            expect(unzip(await mixed.body()).map(entry => entry.name))
                .toEqual(['IMG_0101.jpg', 'travel/Armenia/2016/IMG_0102.jpg', `${bundle.slice(1)}/img_0102.jpg`])
            // The albums have no path in common
            expect(mixed.headers()['content-disposition']).toBe(`attachment; filename="images.zip"; filename*=UTF-8''images.zip`)

            // Photos from several albums are named after the path they have in common
            const travel = await context.request.get(`/download?images=${[ids[0], await imageId(GEORGIA, 'IMG_0001.jpg')].join()}`)
            expect(travel.headers()['content-disposition']).toBe(`attachment; filename="travel.zip"; filename*=UTF-8''travel.zip`)

            // Clients which don't read the UTF-8 name get a plain one. The encoded name escapes the characters
            // RFC 5987 doesn't allow.
            const single = await context.request.get(`/download?images=${ids[2]}`)
            expect(unzip(await single.body()).map(entry => entry.name)).toEqual(['img_0102.jpg'])
            expect(single.headers()['content-disposition'])
                .toBe(`attachment; filename="images.zip"; filename*=UTF-8''${encodeURIComponent(name).replace('(', '%28').replace(')', '%29')}.zip`)
        } finally {
            await context.close()
            // Sync removes the row of the deleted file, a missing folder is just reported as not found
            await rm(copy, { force: true })
            await request.get(encodeURI(bundle))
            await rm(folder, { recursive: true, force: true })
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
            expect(unzip(await repeated.body()).map(entry => entry.name)).toEqual(['IMG_0101.jpg'])
        } finally {
            await context.close()
        }
    })

    test('is built as fast as it is read, and stops when the client disconnects', async ({ request, baseURL }, testInfo) => {
        // Unique album without labels. Photos of noise don't compress, so they fill the buffers between the server and
        // the client quickly. Loopback TCP buffers alone hold 10 MB or more, so the archive is about 40 MB.
        const bundle = `/download-${testInfo.project.name}-${testInfo.repeatEachIndex}`
        const folder = join(photosFolder, bundle)
        const count = 80
        const noise = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 128, sigma: 64 } } })
            .jpeg()
            .toBuffer()
        const names = Array.from({ length: count }, (_, i) => `n${String(i).padStart(2, '0')}.jpg`)
        const rows = async (query: 'image' | 'log', value: string) => {
            const [{ n }] = query === 'image'
                ? await db()<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM image WHERE bundle = ${value}`
                : await db()<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM log WHERE ip = ${value}`
            return n
        }
        const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

        await rm(folder, { recursive: true, force: true })
        await mkdir(folder)
        try {
            for (const name of names)
                await writeFile(join(folder, name), noise)
            // A long sync goes on in the background
            await expect.poll(async () => {
                await request.get(bundle)
                return await rows('image', bundle)
            }, { timeout: 30_000 }).toBe(count)
            const ids = (await db()<{ id: number }[]>`SELECT id FROM image WHERE bundle = ${bundle} ORDER BY name`).map(row => row.id)

            // Read slowly with fetch: Playwright requests read the whole body
            const hash = createHash('sha1').update(`${testInfo.testId}-${testInfo.retry}`).digest()
            const ip = `10.4.${hash[0]}.${hash[1]}`
            const state: { cookies: { name: string, value: string }[] } = JSON.parse(await readFile(asUser, 'utf8'))
            const cookie = state.cookies.map(({ name, value }) => `${name}=${value}`).join('; ')
            const response = await fetch(`${baseURL}/download?images=${ids.join()}`, { headers: { cookie, 'x-real-ip': ip } })
            expect(response.status).toBe(200)
            const reader = (response.body as ReadableStream<Uint8Array>).getReader()
            expect((await reader.read()).done).toBe(false)

            // Photos are logged when added: the server stops a few buffers ahead of the client
            await wait(2000)
            const paused = await rows('log', ip)
            expect(paused).toBeGreaterThan(0)
            expect(paused).toBeLessThan(count / 2)

            await reader.cancel()
            await wait(1000)
            const stopped = await rows('log', ip)
            await wait(1000)
            expect(await rows('log', ip)).toBe(stopped)
            expect(stopped).toBeLessThan(count)
        } finally {
            // Sync removes the rows of deleted files, a missing folder is just reported as not found
            for (const name of names)
                await rm(join(folder, name), { force: true })
            await request.get(bundle)
            await rm(folder, { recursive: true, force: true })
        }
    })

    test('skips censored and missing photos', async ({ browser }) => {
        const ids = [await imageId(ARMENIA, 'IMG_0101.jpg'), await imageId(ARMENIA, 'IMG_0102.jpg'), 999999]
        const context = await browser.newContext({ storageState: asViewer })
        try {
            const response = await context.request.get(`/download?images=${ids.join()}`)
            expect(response.status()).toBe(200)
            expect(unzip(await response.body()).map(entry => entry.name)).toEqual(['IMG_0101.jpg'])
        } finally {
            await context.close()
        }
    })
})
