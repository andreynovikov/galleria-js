import { cache } from 'react'
import { headers } from 'next/headers'

import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { genericOAuth, yandex } from 'better-auth/plugins/generic-oauth'

// Relative imports: this module is also loaded by Playwright global setup, which does not resolve `@/`
import { getUser, type Visitor } from './lib/db'
import { sendEvent } from './lib/ga'

const basePath = process.env.BASE_PATH ?? ''

/** Placeholder for VK accounts without e-mail: Better Auth requires one, but the visitor table does not */
const noEmailDomain = '@vk.invalid'

/** Sign-in providers, in the order they are shown on the sign-in page */
export const providers = [
    { id: 'github', name: 'GitHub' },
    { id: 'google', name: 'Google' },
    { id: 'yandex', name: 'Яндекс' },
    { id: 'mailru', name: 'Mail.ru' },
    { id: 'vk', name: 'VK ID' }
] as const

function credentials(provider: string) {
    const name = provider.toUpperCase()
    return {
        clientId: process.env[`AUTH_${name}_ID`] ?? '',
        clientSecret: process.env[`AUTH_${name}_SECRET`] ?? '',
        // Users are only kept in memory (see below), so a repeated sign-in must refresh them
        overrideUserInfoOnSignIn: true
    }
}

interface MailRuProfile {
    id: string
    name?: string
    email: string
    image?: string
}

/**
 * Better Auth runs stateless: without `database` the session lives in an encrypted cookie (`session_data`)
 * and users, accounts and sessions are kept in an in-memory adapter which is lost on restart, which is fine,
 * because nothing reads them after sign-in. Visitors are identified by provider account id and stored in the
 * `visitor` table, that record is copied into the session when it is created.
 */
export const authOptions = {
    appName: 'Galleria',
    basePath: `${basePath}/api/auth`,
    session: {
        expiresIn: 30 * 24 * 60 * 60,
        updateAge: 24 * 60 * 60,
        additionalFields: {
            visitorId: { type: 'string', required: false, input: false },
            provider: { type: 'string', required: false, input: false },
            censorship: { type: 'number', required: false, input: false }
        }
    },
    account: {
        accountLinking: {
            // Users with the same e-mail are linked into one in-memory user, the visitor is still chosen by
            // provider account. Without trust, signing in with second provider would fail with `account_not_linked`.
            trustedProviders: providers.map(provider => provider.id)
        }
    },
    onAPIError: {
        errorURL: `${basePath}/signin`
    },
    telemetry: {
        enabled: false
    },
    advanced: {
        // Behind a reverse proxy the base URL (OAuth redirect URIs, origin checks) is taken from x-forwarded-host
        // and x-forwarded-proto, unless BETTER_AUTH_URL is set
        trustedProxyHeaders: true
    },
    socialProviders: {
        github: credentials('github'),
        google: credentials('google'),
        vk: {
            ...credentials('vk'),
            disableDefaultScope: true,
            scope: ['email'],
            mapProfileToUser: profile => ({
                email: profile.user.email || `${profile.user.user_id}${noEmailDomain}`
            })
        }
    },
    plugins: [
        genericOAuth({
            config: [
                yandex(credentials('yandex')),
                {
                    providerId: 'mailru',
                    ...credentials('mailru'),
                    authorizationUrl: 'https://oauth.mail.ru/login',
                    tokenUrl: 'https://oauth.mail.ru/token',
                    scopes: ['userinfo'],
                    async getUserInfo(tokens) {
                        const response = await fetch(`https://oauth.mail.ru/userinfo?access_token=${tokens.accessToken}`)
                        if (!response.ok)
                            return null
                        const profile: MailRuProfile = await response.json()
                        return {
                            id: profile.id,
                            name: profile.name,
                            email: profile.email,
                            image: profile.image,
                            emailVerified: true
                        }
                    }
                }
            ]
        })
    ],
    databaseHooks: {
        session: {
            create: {
                async before(session, context) {
                    if (!context)
                        return false
                    // Session is created by OAuth callback (`/callback/:id`) right after the account is linked
                    const providerId = context.params?.id
                    const accounts = await context.context.internalAdapter.findAccounts(session.userId)
                    const account = accounts.find(account => account.providerId === providerId)
                        ?? accounts.toSorted((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0]
                    const user = await context.context.internalAdapter.findUserById(session.userId)
                    if (!account || !user)
                        return false
                    const visitor = await getUser(account.accountId, account.providerId, {
                        name: user.name,
                        email: user.email.endsWith(noEmailDomain) ? null : user.email,
                        image: user.image ?? null
                    })
                    return {
                        data: {
                            ...session,
                            visitorId: visitor.id,
                            provider: visitor.provider,
                            censorship: visitor.censorship
                        }
                    }
                },
                async after(session) {
                    await sendEvent('login', { 'method': session.provider as string })
                }
            }
        }
    }
} satisfies BetterAuthOptions

export const auth = betterAuth(authOptions)

export interface Session {
    user: Visitor
}

/** Signed-in visitor, the same shape as `visitor` table record */
export async function getSessionFromHeaders(headers: Headers): Promise<Session | null> {
    const result = await auth.api.getSession({ headers })
    const { visitorId, provider, censorship } = result?.session ?? {}
    if (!result || !visitorId || !provider)
        return null
    const { user } = result
    return {
        user: {
            id: visitorId,
            provider,
            censorship: censorship ?? 0,
            name: user.name || null,
            email: user.email.endsWith(noEmailDomain) ? null : user.email,
            image: user.image ?? null
        }
    }
}

/** Signed-in visitor of the current request (in server components and route handlers) */
export const getSession = cache(async () => getSessionFromHeaders(await headers()))
