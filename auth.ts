import { cache } from 'react'
import { headers } from 'next/headers'

import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { genericOAuth, yandex } from 'better-auth/plugins/generic-oauth'

// Relative imports: this module is also loaded by Playwright global setup, which does not resolve `@/`
import { getUser, isAdminVisitor, type Visitor } from './lib/db'
import { sendEvent } from './lib/ga'

const basePath = process.env.BASE_PATH ?? ''

/**
 * Users are kept under an e-mail of their own provider account, `<provider>-<account id>@accounts.invalid`, so no
 * two accounts ever share a user. Better Auth links accounts with the same e-mail into one user, whose name, picture
 * and e-mail every sign-in overwrites, so one provider's account could have another's shown as its profile. The
 * e-mail the provider reports (if any) is kept in `contactEmail`.
 */
function accountUser(provider: string, id: unknown, email: unknown) {
    return {
        email: `${provider}-${String(id)}@accounts.invalid`,
        emailVerified: true,
        contactEmail: typeof email === 'string' && email !== '' ? email : null
    }
}

/** Sign-in providers, in the order they are shown on the sign-in page. `SignIn.provider` messages may rename them. */
export const providers = [
    { id: 'github', name: 'GitHub' },
    { id: 'google', name: 'Google' },
    { id: 'yandex', name: 'Yandex' },
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
    user: {
        additionalFields: {
            // Set from the provider profile on every sign-in (see accountUser), which also overwrites any value a
            // client sets; Better Auth leaves out profile fields that aren't client input
            contactEmail: { type: 'string', required: false }
        }
    },
    account: {
        // Every account has a user of its own (accountUser), so there is nothing to link
        accountLinking: {
            enabled: false
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
        github: {
            ...credentials('github'),
            mapProfileToUser: profile => accountUser('github', profile.id, profile.email)
        },
        google: {
            ...credentials('google'),
            mapProfileToUser: profile => accountUser('google', profile.sub, profile.email)
        },
        vk: {
            ...credentials('vk'),
            disableDefaultScope: true,
            scope: ['email'],
            mapProfileToUser: profile => accountUser('vk', profile.user.user_id, profile.user.email)
        }
    },
    plugins: [
        genericOAuth({
            config: [
                {
                    ...yandex(credentials('yandex')),
                    mapProfileToUser: profile => accountUser('yandex', profile.id, profile.email)
                },
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
                            // Not known, and not needed: accounts are never linked (accountUser)
                            emailVerified: false
                        }
                    },
                    mapProfileToUser: profile => accountUser('mailru', profile.id, profile.email)
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
                        email: contactEmail(user),
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

/** The e-mail the provider reported for the user's account, if any */
function contactEmail(user: object) {
    const value = (user as { contactEmail?: unknown }).contactEmail
    return typeof value === 'string' && value !== '' ? value : null
}

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
            email: contactEmail(user),
            image: user.image ?? null
        }
    }
}

/** Signed-in visitor of the current request (in server components and route handlers) */
export const getSession = cache(async () => getSessionFromHeaders(await headers()))

/** Whether the visitor is listed in `ADMIN_ID` (as `provider:id`) */
export function isAdmin(session: Session | null) {
    return isAdminVisitor(session?.user)
}

/** Highest `image.censored` value the visitor may see: anonymous visitors see only uncensored photos */
export function censorshipLevel(session: Session | null) {
    return session?.user.censorship ?? 0
}
