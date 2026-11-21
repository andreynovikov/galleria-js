import { createHash } from 'node:crypto'

import { expect, test } from '@playwright/test'

import { ARMENIA, GEORGIA, asUser, asViewer, description, imageId, labelId, lightbox, thumbnail, thumbnails } from './helpers'

test.describe('anonymous visitor', () => {
    test('is asked to sign in to see history', async ({ page }) => {
        await page.goto('/history')
        await expect(page).toHaveURL(`/signin?callbackUrl=${encodeURIComponent('/history')}`)
        for (const provider of ['GitHub', 'Google', 'Яндекс', 'Mail.ru', 'VK ID'])
            await expect(page.getByRole('button', { name: `Войти через ${provider}` })).toBeVisible()
    })

    test('is asked to sign in to filter by restricted label', async ({ page }) => {
        await page.goto('/?-filt.labels=Private')
        await expect(page).toHaveURL(`/signin?callbackUrl=${encodeURIComponent('/?-filt.labels=Private')}`)
    })

    test('is asked to sign in to filter by restricted label id', async ({ page }) => {
        const id = await labelId('Private')
        for (const path of [`/?-filt.labels=${id}`, `${GEORGIA}?-filt.labels=${id}`]) {
            await page.goto(path)
            await expect(page).toHaveURL(`/signin?callbackUrl=${encodeURIComponent(path)}`)
        }
    })

    test.describe('signing in', () => {
        // Better Auth limits sign-in requests to 3 per 10 seconds from one IP, tests come from different "clients"
        test.beforeEach(async ({ page }, testInfo) => {
            const hash = createHash('sha1').update(`${testInfo.testId}-${testInfo.retry}`).digest()
            await page.setExtraHTTPHeaders({ 'x-forwarded-for': `10.1.${hash[0]}.${hash[1]}` })
        })

        const providers = [
            { id: 'github', name: 'GitHub', authorizationUrl: 'https://github.com/login/oauth/authorize' },
            { id: 'google', name: 'Google', authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth' },
            { id: 'yandex', name: 'Яндекс', authorizationUrl: 'https://oauth.yandex.com/authorize' },
            { id: 'mailru', name: 'Mail.ru', authorizationUrl: 'https://oauth.mail.ru/login' },
            { id: 'vk', name: 'VK ID', authorizationUrl: 'https://id.vk.com/authorize' }
        ]

        for (const { id, name, authorizationUrl } of providers) {
            test(`is sent to ${name} with the registered callback URL`, async ({ page, baseURL }) => {
                // The provider page is not opened, only the authorization request is checked
                await page.route(`${new URL(authorizationUrl).origin}/**`, route => route.fulfill({ body: 'provider' }))
                await page.goto(`/signin?callbackUrl=${encodeURIComponent(GEORGIA)}`)
                const request = page.waitForRequest(request => request.url().startsWith(authorizationUrl))
                await page.getByRole('button', { name: `Войти через ${name}` }).click()
                const url = new URL((await request).url())
                // OAuth applications are registered with the callback URLs which were used by NextAuth
                expect(url.searchParams.get('redirect_uri')).toBe(`${baseURL}/api/auth/callback/${id}`)
                expect(url.searchParams.get('client_id')).toBe('e2e')
                expect(url.searchParams.get('state')).toBeTruthy()
            })
        }

        test('can not use sign-in page as open redirect', async ({ page }) => {
            await page.route('https://github.com/**', route => route.fulfill({ body: 'provider' }))
            const request = page.waitForRequest(request => request.url().endsWith('/api/auth/sign-in/social'))
            await page.goto(`/signin?callbackUrl=${encodeURIComponent('https://example.com/')}`)
            await page.getByRole('button', { name: 'Войти через GitHub' }).click()
            // Foreign callbackUrl is replaced with the site root
            expect((await request).postDataJSON().callbackURL).toBe('/')
        })
    })

    test('sees sign-in error', async ({ page }) => {
        await page.goto('/signin?error=access_denied')
        // Next adds its own route announcer with alert role
        await expect(page.getByRole('alert').filter({ hasText: 'Вход' })).toHaveText('Вход отменён.')
    })

    test('can not download album', async ({ page }) => {
        await page.goto(GEORGIA)
        await expect(thumbnails(page)).toHaveCount(3)
        await expect(page.getByRole('button', { name: 'Скачать все фотографии' })).toHaveCount(0)
    })
})

test.describe('signed-in visitor without censorship level', () => {
    test.use({ storageState: asViewer })

    test('does not see censored photos', async ({ page }) => {
        await page.goto(`${ARMENIA}?-filt.censored=9`)
        await expect(thumbnails(page)).toHaveCount(1)
        await expect(thumbnail(page, await imageId(ARMENIA, 'IMG_0101.jpg'))).toBeVisible()
    })
})

test.describe('signed-in visitor', () => {
    test.use({ storageState: asUser })

    test('can filter by restricted label', async ({ page }) => {
        await page.goto('/?-filt.labels=Private')
        await expect(page).toHaveTitle('Фотографии с тегом Private')
        await expect(thumbnails(page)).toHaveCount(1)
    })

    test('can view restricted photo', async ({ page }) => {
        const id = await imageId(GEORGIA, 'IMG_0003.jpg')
        await page.goto(GEORGIA)
        await thumbnail(page, id).click()
        await expect(lightbox(page)).toBeVisible()
        await expect(lightbox(page).locator('.yarl__slide_current img')).toHaveAttribute('src', `${GEORGIA}/IMG_0003.jpg`)
    })

    test('sees photos allowed by censorship level', async ({ page }) => {
        await page.goto(ARMENIA)
        await expect(thumbnails(page)).toHaveCount(2)
        await expect(thumbnail(page, await imageId(ARMENIA, 'IMG_0102.jpg'))).toBeVisible()
    })

    test('sees description of censored photo allowed by censorship level', async ({ page }) => {
        const id = await imageId(ARMENIA, 'IMG_0102.jpg')
        await page.goto(ARMENIA)
        await thumbnail(page, id).click()
        await expect(description(page).locator('.title')).toHaveText('Без тегов')
    })

    test('can lower censorship level with filter', async ({ page }) => {
        await page.goto(`${ARMENIA}?-filt.censored=0`)
        await expect(thumbnails(page)).toHaveCount(1)
        await expect(thumbnail(page, await imageId(ARMENIA, 'IMG_0101.jpg'))).toBeVisible()
    })

    test('downloads album', async ({ page }) => {
        await page.goto(ARMENIA)
        await expect(thumbnails(page)).toHaveCount(2)
        const requests: string[] = []
        page.on('request', request => {
            if (new URL(request.url()).pathname === '/download')
                requests.push(`${request.method()}${request.headers()['rsc'] ? ' (router)' : ''}`)
        })
        const download = page.waitForEvent('download')
        await page.getByRole('button', { name: 'Скачать все фотографии' }).click()
        expect((await download).suggestedFilename()).toBe('images.zip')
        // A single browser request: no extra router fetch (which builds the archive twice) and no server actions
        // misdirected to the download route
        expect(requests).toEqual(['GET'])
    })

    test('is not allowed to see history', async ({ page }) => {
        await page.goto('/history')
        await expect(page).toHaveURL(/\/signin/)
    })
})
