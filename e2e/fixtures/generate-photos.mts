/*
 * Generates synthetic test photos with EXIF and IPTC metadata.
 *
 * The generated files are committed, so CI does not need exiftool. Re-run only to change them:
 *
 *     node e2e/fixtures/generate-photos.mts
 *
 * Requires exiftool (Debian package `libimage-exiftool-perl`), because sharp cannot write IPTC.
 * When you change anything here, update the expectations in e2e/*.spec.ts.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import sharp from 'sharp'

interface Fixture {
    path: string
    text: string
    colors: [string, string]
    width: number
    height: number
    date: string
    keywords?: string[]
    caption?: string
    exif?: Record<string, string>
}

const root = dirname(new URL(import.meta.url).pathname)

const fixtures: Fixture[] = [
    {
        path: 'photos/travel/Georgia/2015/IMG_0001.jpg',
        text: 'Georgia 1',
        colors: ['#1e3c72', '#2a5298'],
        width: 1600,
        height: 1067,
        date: '2015:06:25 10:00:00',
        keywords: ['Горы', 'Омало'],
        caption: 'Вид на Омало',
        exif: { FocalLength: '35', ISO: '100', ExposureTime: '1/250', FNumber: '8' }
    },
    {
        path: 'photos/travel/Georgia/2015/IMG_0002.jpg',
        text: 'Georgia 2',
        colors: ['#134e5e', '#71b280'],
        width: 1067,
        height: 1600,
        date: '2015:06:26 12:00:00',
        keywords: ['Горы', 'Таня'],
        caption: 'Таня в горах'
    },
    {
        path: 'photos/travel/Georgia/2015/IMG_0003.jpg',
        text: 'Georgia 3',
        colors: ['#614385', '#516395'],
        width: 1600,
        height: 1067,
        date: '2015:06:27 09:00:00',
        keywords: ['Private', 'Таня']
    },
    {
        path: 'photos/travel/Armenia/2016/IMG_0101.jpg',
        text: 'Armenia 1',
        colors: ['#e65c00', '#f9d423'],
        width: 1600,
        height: 1067,
        date: '2016:05:01 15:30:00',
        keywords: ['Горы']
    },
    {
        // Marked as censored by e2e/global-setup.ts
        path: 'photos/travel/Armenia/2016/IMG_0102.jpg',
        text: 'Armenia 2',
        colors: ['#cb2d3e', '#ef473a'],
        width: 1600,
        height: 1067,
        date: '2016:05:02 08:15:00',
        caption: 'Без тегов'
    },
    {
        // Stored as landscape pixels with orientation 6 (rotate 90° CW), so it is displayed as portrait
        path: 'photos/family/2020/DSC_0001.jpg',
        text: 'Family 1',
        colors: ['#ee9ca7', '#ffdde1'],
        width: 1600,
        height: 1067,
        date: '2020:01:01 18:00:00',
        keywords: ['Таня'],
        exif: { Orientation: '6' }
    },
    {
        // Censored by e2e/global-setup.ts: anonymous visitors see neither the album nor its label
        path: 'photos/hidden/2020/IMG_0201.jpg',
        text: 'Hidden',
        colors: ['#614385', '#516395'],
        width: 1600,
        height: 1067,
        date: '2020:06:06 06:06:06',
        keywords: ['Скрытое']
    },
    {
        // Not part of the archive: e2e/sync.spec.ts copies it over another file to test metadata updates
        path: 'extra/updated.jpg',
        text: 'Updated',
        colors: ['#0f2027', '#2c5364'],
        width: 1600,
        height: 1067,
        date: '2021:03:04 05:06:07',
        caption: 'Обновлённое описание'
    },
    {
        // Not part of the archive: its label is restricted, but does not exist until e2e/sync.spec.ts adds the photo
        path: 'extra/secret.jpg',
        text: 'Secret',
        colors: ['#232526', '#414345'],
        width: 1600,
        height: 1067,
        date: '2022:02:02 02:02:02',
        keywords: ['Secret']
    }
]

function svg({ width, height, colors, text }: Fixture) {
    return Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${colors[0]}"/>
      <stop offset="1" stop-color="${colors[1]}"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <circle cx="${width * 0.75}" cy="${height * 0.3}" r="${Math.min(width, height) * 0.12}" fill="#ffffff" fill-opacity="0.6"/>
  <text x="50%" y="55%" font-family="sans-serif" font-size="${Math.round(Math.min(width, height) / 6)}"
        fill="#ffffff" text-anchor="middle" dominant-baseline="middle">${text}</text>
</svg>`)
}

rmSync(join(root, 'photos'), { recursive: true, force: true })
rmSync(join(root, 'extra'), { recursive: true, force: true })

for (const fixture of fixtures) {
    const file = join(root, fixture.path)
    mkdirSync(dirname(file), { recursive: true })
    await sharp(svg(fixture)).jpeg({ quality: 70, mozjpeg: true }).toFile(file)

    const args = [
        '-q', '-overwrite_original',
        '-charset', 'iptc=UTF8',
        '-IPTC:CodedCharacterSet=UTF8',
        `-EXIF:DateTimeOriginal=${fixture.date}`,
        `-EXIF:CreateDate=${fixture.date}`
    ]
    for (const keyword of fixture.keywords ?? [])
        args.push(`-IPTC:Keywords=${keyword}`)
    if (fixture.caption)
        args.push(`-IPTC:Caption-Abstract=${fixture.caption}`)
    for (const [tag, value] of Object.entries(fixture.exif ?? {}))
        args.push(tag === 'Orientation' ? `-EXIF:Orientation#=${value}` : `-EXIF:${tag}=${value}`)
    execFileSync('exiftool', [...args, file], { stdio: 'inherit' })
    console.log(fixture.path)
}
