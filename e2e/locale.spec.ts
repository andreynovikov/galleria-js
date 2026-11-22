import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { preferredLanguages, withFallback } from '../i18n/locales'
import { GEORGIA, lightbox } from './helpers'

// The other specs run with the ru-RU browser locale of playwright.config.ts and check the Russian text

test('reads the preferred languages from Accept-Language', () => {
    expect(preferredLanguages(null)).toEqual([])
    expect(preferredLanguages('')).toEqual([])
    expect(preferredLanguages('ru')).toEqual(['ru'])
    expect(preferredLanguages('ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7')).toEqual(['ru', 'en'])
    expect(preferredLanguages('RU-ru')).toEqual(['ru'])
    expect(preferredLanguages('de-DE, de;q=0.9, ru;q=0.5')).toEqual(['de', 'ru'])
    expect(preferredLanguages('en;q=0.3, ru;q=0.7')).toEqual(['ru', 'en'])
    // Equal quality values keep the order of the header
    expect(preferredLanguages('en;q=0.5, ru;q=0.5')).toEqual(['en', 'ru'])
    // q=0 means "not this one", and `*` any language, so the default one does
    expect(preferredLanguages('ru;q=0')).toEqual([])
    expect(preferredLanguages('ru;q=abc, en;q=0.1')).toEqual(['en'])
    expect(preferredLanguages('de, *;q=0.5, ru;q=0.1')).toEqual(['de'])
    // Only bare subtags become names of message files
    expect(preferredLanguages('../en, x-pig-latin, e n, ru;q=0.5')).toEqual(['ru'])
})

test('takes messages a translation lacks from English', () => {
    const english = { Titles: { photos: 'Photos', signIn: 'Sign in' }, Album: { downloadAll: 'Download all photos' } }
    expect(withFallback({ Titles: { photos: 'Fotos' } }, english))
        .toEqual({ Titles: { photos: 'Fotos', signIn: 'Sign in' }, Album: { downloadAll: 'Download all photos' } })
})

/** Dotted keys of the messages in a file, such as `SignIn.errors.failed` */
function messageKeys(messages: object, prefix = ''): string[] {
    return Object.entries(messages).flatMap(([key, value]) =>
        typeof value === 'object' ? messageKeys(value, `${prefix}${key}.`) : [`${prefix}${key}`])
}

test('every language has the messages of English', async () => {
    const folder = join(__dirname, '../i18n/messages')
    const read = async (file: string) => messageKeys(JSON.parse(await readFile(join(folder, file), 'utf8'))).sort()
    const english = await read('en.json')
    const files = (await readdir(folder)).filter(file => file.endsWith('.json'))
    expect(files).toContain('ru.json')
    for (const file of files) {
        // A file name is a language subtag, as preferredLanguages() gives them
        expect(file).toMatch(/^[a-z]{2,3}\.json$/)
        expect(await read(file), file).toEqual(english)
    }
})

test('pages are in the language of the request and are not cached', async ({ request }) => {
    // German has no translation, so the next language the browser accepts is used; English when there is none
    const cases = [['ru-RU, en;q=0.5', 'ru'], ['de-DE, ru;q=0.5', 'ru'], ['de-DE, en;q=0.7, ru;q=0.5', 'en'], ['fr', 'en'], ['', 'en']]
    for (const [acceptLanguage, lang] of cases) {
        const response = await request.get('/', { headers: { 'accept-language': acceptLanguage } })
        expect(response.status()).toBe(200)
        expect(await response.text()).toContain(`<html lang="${lang}"`)
        // Next sends its own Vary, without Accept-Language, so a cache must not keep pages at all
        expect(response.headers()['cache-control']).toContain('no-store')
    }
})

test.describe('in English', () => {
    test.use({ locale: 'en-US' })

    test('shows the landing page', async ({ page }) => {
        await page.goto('/')
        await expect(page).toHaveTitle('Albums and tags')
        await expect(page.locator('html')).toHaveAttribute('lang', 'en')
        await expect(page.getByRole('heading', { name: 'Albums' })).toBeVisible()
        // Text of a client component
        await page.locator('.tag-cloud-tag', { hasText: 'Горы' }).click()
        await expect(page.getByRole('button', { name: 'Show' })).toBeVisible()
    })

    test('titles galleries by their filters', async ({ page }) => {
        await page.goto(GEORGIA)
        await expect(page).toHaveTitle('Photos from travel/Georgia/2015')
        await expect(page.getByRole('link', { name: 'All albums' })).toBeVisible()

        await page.goto('/?-filt.labels=Горы')
        await expect(page).toHaveTitle('Photos with tag Горы')
        await page.goto('/?-filt.labels=Горы,Таня')
        await expect(page).toHaveTitle('Photos with tags Горы, Таня')
        await page.goto(`${GEORGIA}?-filt.from=2015-06-26&-filt.till=2015-06-27`)
        await expect(page).toHaveTitle(/^Photos from travel\/Georgia\/2015 after June 26, 2015.+ before June 27, 2015.+$/)
        // A malformed date is not applied, so it is not in the title either
        await page.goto(`${GEORGIA}?-filt.from=yesterday`)
        await expect(page).toHaveTitle('Photos from travel/Georgia/2015')
    })

    test('shows the sign-in page', async ({ page }) => {
        await page.goto('/signin')
        await expect(page).toHaveTitle('Sign in')
        for (const provider of ['GitHub', 'Google', 'Yandex', 'Mail.ru', 'VK ID'])
            await expect(page.getByRole('button', { name: `Sign in with ${provider}` })).toBeVisible()

        await page.goto('/signin?error=access_denied')
        // Next adds its own route announcer with alert role
        await expect(page.getByRole('alert').filter({ hasText: 'Sign-in' })).toHaveText('Sign-in was cancelled.')
        // Unknown codes, including names of Object.prototype members, get the general message
        for (const code of ['unknown', 'constructor']) {
            await page.goto(`/signin?error=${code}`)
            await expect(page.getByRole('alert').filter({ hasText: 'sign in' })).toHaveText('Could not sign in, please try again.')
        }
    })

    test('labels the lightbox buttons', async ({ page }) => {
        await page.goto(`${GEORGIA}#view-0-0`)
        await expect(lightbox(page)).toBeVisible()
        await expect(lightbox(page).getByRole('button', { name: 'Close' })).toBeVisible()
        await expect(lightbox(page).getByRole('button', { name: 'Zoom in' })).toBeVisible()
    })
})

test.describe('in Russian', () => {
    test('labels the lightbox buttons', async ({ page }) => {
        await page.goto(`${GEORGIA}#view-0-0`)
        await expect(lightbox(page)).toBeVisible()
        await expect(page.locator('html')).toHaveAttribute('lang', 'ru')
        await expect(lightbox(page).getByRole('button', { name: 'Закрыть' })).toBeVisible()
        await expect(lightbox(page).getByRole('button', { name: 'Увеличить' })).toBeVisible()
    })
})
