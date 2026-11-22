import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { request, type IncomingHttpHeaders, type IncomingMessage } from 'node:http'
import { join } from 'node:path'

import { expect, test, type TestInfo } from '@playwright/test'

import { basePath, fixturesFolder, publicURL } from './env'
import { GEORGIA, asUser, cookieHeader, logCount, noiseAlbum, wait } from './helpers'

/*
 * The README nginx example in front of the app (playwright.nginx.config.ts). nginx limits rates per client address
 * and passes it to the app, so every test sends its requests from a loopback address of its own (all of 127.0.0.0/8
 * is local on Linux): their limits and log rows don't mix.
 */

const nginx = new URL(publicURL)

/** A loopback address of the test's own, other than 127.0.0.1 */
function clientAddress(testInfo: TestInfo) {
    const hash = createHash('sha1').update(`${testInfo.testId}-${testInfo.retry}`).digest()
    return `127.${hash[0] % 250 + 2}.${hash[1]}.${hash[2] % 250 + 2}`
}

/** Sends a request to nginx from `from` and returns the response with its body unread */
function open(path: string, from: string, headers: Record<string, string> = {}) {
    return new Promise<IncomingMessage>((resolve, reject) => {
        const req = request({
            host: '127.0.0.1',
            port: nginx.port,
            path: basePath + path,
            localAddress: from,
            headers: { host: nginx.host, ...headers }
        }, resolve)
        req.on('error', reject)
        req.end()
    })
}

async function get(path: string, from: string, headers: Record<string, string> = {}): Promise<{ status: number, headers: IncomingHttpHeaders, body: Buffer }> {
    const response = await open(path, from, headers)
    const chunks: Buffer[] = []
    for await (const chunk of response)
        chunks.push(chunk)
    return { status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) }
}

/** Status codes of the requests, sent 20 at a time, with their counts */
async function statuses(paths: string[], from: string) {
    const counts: Record<number, number> = {}
    const queue = [...paths]
    await Promise.all(Array.from({ length: 20 }, async () => {
        for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
            const { status } = await get(path, from)
            counts[status] = (counts[status] ?? 0) + 1
        }
    }))
    return counts
}

test.describe('nginx example', () => {
    test('serves the landing page without a redirect loop', async ({}, testInfo) => {
        const from = clientAddress(testInfo)
        expect((await get('', from)).status).toBe(200)
        // Next removes the trailing slash; nginx alone would add it back
        const slash = await get('/', from)
        expect(slash.status).toBe(308)
        expect(new URL(slash.headers.location ?? '', publicURL).pathname).toBe(basePath)
    })

    test('passes albums and photos to the app, and serves static files itself', async ({}, testInfo) => {
        const from = clientAddress(testInfo)
        expect((await get(GEORGIA, from)).status).toBe(200)
        const photo = await get(`${GEORGIA}/IMG_0001.jpg`, from)
        expect(photo.status).toBe(200)
        expect(photo.headers['content-type']).toBe('image/jpeg')

        const landing = (await get('', from)).body.toString()
        const script = landing.match(new RegExp(`${basePath}(/_next/static/[^"]+\\.js)`))?.[1]
        expect(script).toBeDefined()
        const asset = await get(script as string, from)
        expect(asset.status).toBe(200)
        // Set by `expires` in nginx; the app sends none
        expect(asset.headers['expires']).toBeDefined()
    })

    test('passes ranges, so downloads of originals resume', async ({}, testInfo) => {
        const from = clientAddress(testInfo)
        const file = await readFile(join(fixturesFolder, 'photos', GEORGIA, 'IMG_0001.jpg'))
        const url = `${GEORGIA}/IMG_0001.jpg?format=original`
        const first = await get(url, from, { range: 'bytes=0-99' })
        expect(first.status).toBe(206)
        const rest = await get(url, from, { range: 'bytes=100-', 'if-range': first.headers.etag as string })
        expect(rest.status).toBe(206)
        expect(Buffer.concat([first.body, rest.body]).equals(file)).toBe(true)
    })

    test('passes the address it sees, not the one a client claims', async ({}, testInfo) => {
        const from = clientAddress(testInfo)
        const forged = ['198.51.100.7', '198.51.100.8']
        const response = await get(`${GEORGIA}/IMG_0001.jpg?ratio=0.33`, from, { 'x-forwarded-for': forged[0], 'x-real-ip': forged[1] })
        expect(response.status).toBe(200)
        await expect.poll(() => logCount(from)).toBe(1)
        for (const ip of forged)
            expect(await logCount(ip), ip).toBe(0)
    })

    test('limits resized versions per address', async ({}, testInfo) => {
        const from = clientAddress(testInfo)
        const counts = await statuses(Array.from({ length: 40 }, (_, i) => `${GEORGIA}/IMG_0001.jpg?ratio=0.${i % 9 + 1}`), from)
        // The burst of 30, and maybe a few more refilled meanwhile
        expect(counts[200]).toBeGreaterThanOrEqual(30)
        expect(counts[429]).toBeGreaterThan(0)
    })

    test('lets thumbnails through the limit of resized versions', async ({}, testInfo) => {
        const from = clientAddress(testInfo)
        const counts = await statuses(Array.from({ length: 120 }, () => `${GEORGIA}/IMG_0001.jpg?format=thumbnail&size=s`), from)
        expect(counts).toEqual({ 200: 120 })
    })

    test('limits pages per address', async ({}, testInfo) => {
        const from = clientAddress(testInfo)
        const counts = await statuses(Array.from({ length: 130 }, () => GEORGIA), from)
        expect(counts[200]).toBeGreaterThanOrEqual(100)
        expect(counts[429]).toBeGreaterThan(0)
    })

    test('passes album downloads without buffering them', async ({}, testInfo) => {
        const from = clientAddress(testInfo)
        const count = 80
        const album = await noiseAlbum(`/nginx-download-${testInfo.repeatEachIndex}`, count, bundle => get(bundle, from))
        try {
            const response = await open(`/download?images=${album.ids.join()}`, from, { cookie: await cookieHeader(asUser) })
            expect(response.statusCode).toBe(200)
            await new Promise(resolve => response.once('data', resolve))
            response.pause()

            // Photos are logged as they are added: without buffering the app stops once the buffers between it and
            // the paused client are full; with buffering, nginx would read on until the archive is complete
            await wait(4000)
            const added = await logCount(from)
            await wait(2000)
            expect(await logCount(from)).toBe(added)
            expect(added).toBeGreaterThan(0)
            expect(added).toBeLessThan(count)
            response.destroy()
        } finally {
            await album.remove()
        }
    })
})
