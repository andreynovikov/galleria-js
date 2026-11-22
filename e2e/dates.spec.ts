import { stat } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { parseDate } from '../lib/utils'
import { photosFolder } from './env'
import { GEORGIA, db, imageId, thumbnail, thumbnails } from './helpers'

// The server and these tests run in America/New_York (e2e/env.ts), not in UTC like Docker, so that times depending on
// the server's zone show up as hours off

test('reads dates and times as written, in UTC', () => {
    const utc = (value: string) => parseDate(value)?.toISOString()
    expect(utc('2015-06-26')).toBe('2015-06-26T00:00:00.000Z')
    expect(utc('2015-06-26T10:00')).toBe('2015-06-26T10:00:00.000Z')
    expect(utc('2015-06-26 10:00:30.25')).toBe('2015-06-26T10:00:30.250Z')
    // EXIF, sometimes with a zone, which is ignored like PostgreSQL ignores it for timestamp columns
    expect(utc('2015:06:26 10:00:00')).toBe('2015-06-26T10:00:00.000Z')
    expect(utc('2009-09-23 17:40:52 UTC')).toBe('2009-09-23T17:40:52.000Z')
    expect(utc('2015-06-26T10:00:00+03:00')).toBe('2015-06-26T10:00:00.000Z')
    expect(utc('0050-01-01')).toBe('0050-01-01T00:00:00.000Z')
    // Not dates: unset camera clocks, days that don't exist, words
    for (const value of [undefined, '', 'yesterday', '0000:00:00 00:00:00', '2015-02-29', '2015-06-31', '2015-06-26T24:00', '2015-06-26foo', 'June 26, 2015'])
        expect(parseDate(value), value).toBeUndefined()
})

test('keeps the shooting time of the camera and the moments of the files', async () => {
    const rows = await db()<{ name: string, stime: string, mtime: Date }[]>`
      SELECT name, stime::text, mtime FROM image WHERE bundle = ${GEORGIA} ORDER BY name
    `
    // As e2e/fixtures/generate-photos.mts writes them
    expect(rows.map(({ name, stime }) => [name, stime])).toEqual([
        ['IMG_0001.jpg', '2015-06-25 10:00:00'],
        ['IMG_0002.jpg', '2015-06-26 12:00:00'],
        ['IMG_0003.jpg', '2015-06-27 09:00:00']
    ])
    for (const { name, mtime } of rows)
        expect(mtime.getTime(), name).toBe(Math.floor((await stat(join(photosFolder, GEORGIA, name))).mtimeMs))
})

test('filters by the shooting time to the minute', async ({ page, request }) => {
    const url = `${GEORGIA}?-filt.from=2015-06-26T12:00&-filt.till=2015-06-26%2012:00`
    await page.goto(url)
    await expect(thumbnails(page)).toHaveCount(1)
    await expect(thumbnail(page, await imageId(GEORGIA, 'IMG_0002.jpg'))).toBeVisible()

    const html = await (await request.get(url, { headers: { 'accept-language': 'en' } })).text()
    expect(html).toMatch(/<title>Photos from travel\/Georgia\/2015 after June 26, 2015 at 12:00\sPM before June 26, 2015 at 12:00\sPM<\/title>/)
})
