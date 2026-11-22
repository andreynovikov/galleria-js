import { expect, test } from '@playwright/test'

import { env } from './env'
import { db } from './helpers'
import { auth } from '../auth'

/*
 * Users of sign-in providers, as Better Auth's own provider code makes them from the profiles the providers send
 * (their APIs are stubbed): every account gets a user of its own, so two accounts with the same e-mail are never
 * linked into one, and the reported e-mail is kept as contactEmail.
 */

const email = 'alice@example.com'

/** Responses of the providers' APIs, by URL prefix */
const apis: Record<string, unknown> = {
    'https://github.com/login/oauth/access_token': { access_token: 'token', token_type: 'bearer', scope: 'read:user,user:email' },
    'https://oauth.yandex.com/token': { access_token: 'token', token_type: 'bearer', expires_in: 3600 },
    'https://api.github.com/user/emails': [{ email, primary: true, verified: true }],
    'https://api.github.com/user': { id: 101, login: 'alice', name: 'Alice', email: null, avatar_url: 'https://example.com/a.png' },
    'https://id.vk.com/oauth2/user_info': { user: { user_id: '202', first_name: 'Alice', last_name: 'A', email, avatar: 'https://example.com/a.png' } },
    'https://login.yandex.ru/info': { id: '303', default_email: email, display_name: 'Alice' },
    'https://oauth.mail.ru/userinfo': { id: '404', name: 'Alice', email }
}

/** An unsigned Google ID token: Google's provider only decodes it */
function googleIdToken(claims: object) {
    const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
    return `${part({ alg: 'none' })}.${part(claims)}.`
}

async function userOf(providerId: string, tokens: Record<string, string>) {
    const context = await auth.$context
    const provider = context.socialProviders.find(provider => provider.id === providerId)
    expect(provider, providerId).toBeDefined()
    // The mapped user carries contactEmail, which Better Auth's type doesn't know of
    return (await provider!.getUserInfo({ accessToken: 'token', ...tokens }))?.user as { email?: string | null, name?: string, contactEmail?: string | null } | undefined
}

/** Answers the providers' APIs from `apis` while `run` runs */
async function withProviders<T>(run: () => Promise<T>) {
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : String(input)
        const match = Object.keys(apis).find(prefix => url.startsWith(prefix))
        if (match === undefined)
            throw new Error(`Unexpected request to ${url}`)
        return Response.json(apis[match])
    }) as typeof fetch
    try {
        return await run()
    } finally {
        globalThis.fetch = realFetch
    }
}

/** Signs in through Better Auth's own endpoints: the sign-in request, then the provider's redirect back */
async function signIn(provider: string) {
    const origin = env.BETTER_AUTH_URL
    const start = await auth.handler(new Request(`${origin}/api/auth/sign-in/social`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify({ provider, callbackURL: '/' })
    }))
    expect(start.status, provider).toBe(200)
    const state = new URL((await start.json()).url).searchParams.get('state')
    const cookies = start.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ')
    const callback = await auth.handler(new Request(`${origin}/api/auth/callback/${provider}?code=code&state=${state}`, {
        headers: { cookie: cookies }
    }))
    expect(callback.status, provider).toBe(302)
    expect(callback.headers.get('location'), provider).not.toContain('error')
}

test('signing in with two providers reporting the same e-mail keeps two users and visitors', async () => {
    await db()`DELETE FROM visitor WHERE (id, provider) IN (('101', 'github'), ('303', 'yandex'))`
    try {
        await withProviders(async () => {
            await signIn('github')
            await signIn('yandex')
        })
        const visitors = await db()<{ id: string, provider: string, data: { name?: string, email?: string } }[]>`
          SELECT id, provider, data FROM visitor WHERE (id, provider) IN (('101', 'github'), ('303', 'yandex')) ORDER BY provider
        `
        expect(visitors.map(({ id, provider, data }) => ({ id, provider, name: data.name, email: data.email }))).toEqual([
            { id: '101', provider: 'github', name: 'Alice', email },
            { id: '303', provider: 'yandex', name: 'Alice', email }
        ])
        // Not linked: each account has its own in-memory user
        const context = await auth.$context
        for (const [provider, id] of [['github', '101'], ['yandex', '303']]) {
            const found = await context.internalAdapter.findUserByEmail(`${provider}-${id}@accounts.invalid`, { includeAccounts: true })
            expect(found?.accounts.map(account => account.providerId), provider).toEqual([provider])
            expect((found?.user as { contactEmail?: string } | undefined)?.contactEmail, provider).toBe(email)
        }
        expect(await context.internalAdapter.findUserByEmail(email)).toBeNull()
    } finally {
        await db()`DELETE FROM visitor WHERE (id, provider) IN (('101', 'github'), ('303', 'yandex'))`
    }
})

test('every provider account has a user of its own, with the reported e-mail kept aside', async () => {
    await withProviders(async () => {
        const users = {
            github: await userOf('github', {}),
            google: await userOf('google', { idToken: googleIdToken({ sub: '505', email, email_verified: true, name: 'Alice' }) }),
            vk: await userOf('vk', {}),
            yandex: await userOf('yandex', {}),
            mailru: await userOf('mailru', {})
        }
        const ids = { github: '101', google: '505', vk: '202', yandex: '303', mailru: '404' }
        for (const [provider, user] of Object.entries(users)) {
            expect(user?.email, provider).toBe(`${provider}-${ids[provider as keyof typeof ids]}@accounts.invalid`)
            expect(user?.contactEmail, provider).toBe(email)
            expect(user?.name, provider).toBeTruthy()
        }
        // The same reported e-mail, five users: nothing to link
        expect(new Set(Object.values(users).map(user => user?.email)).size).toBe(5)

        // A VK account without an e-mail can still sign in
        apis['https://id.vk.com/oauth2/user_info'] = { user: { user_id: '206', first_name: 'Bob', last_name: 'B' } }
        const withoutEmail = await userOf('vk', {})
        expect(withoutEmail?.email).toBe('vk-206@accounts.invalid')
        expect(withoutEmail?.contactEmail).toBeNull()
        apis['https://id.vk.com/oauth2/user_info'] = { user: { user_id: '202', first_name: 'Alice', last_name: 'A', email, avatar: 'https://example.com/a.png' } }
    })
})
