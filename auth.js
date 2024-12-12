import NextAuth from 'next-auth'
import GitHub from 'next-auth/providers/github'
import Google from 'next-auth/providers/google'
import MailRu from 'next-auth/providers/mailru'
import Vk from 'next-auth/providers/vk'
import Yandex from 'next-auth/providers/yandex'

import { sendEvent } from 'lib/ga'

const basePath = process.env.BASE_PATH ?? ''

export const { auth, handlers, signIn, signOut } = NextAuth({
    basePath: `${basePath}/api/auth`,
    providers: [
        GitHub,
        Google,
        MailRu,
        Yandex,
        {
            ...Vk({
                checks: []
            }),
            token: {
                url: 'https://oauth.vk.com/access_token?v=5.131',
                conform: async (response) => {
                    const data = await response.json()
                    return new Response(
                        JSON.stringify({
                            token_type: 'dpop',
                            ...data,
                        }),
                        {
                            headers: { "content-type": "application/json" },
                            status: response.status
                        }
                    )
                }
            }
        }
    ],
    callbacks: {
        async signIn({ account }) {
            await sendEvent('login', { 'method': account.provider })
            return true
        },
        jwt({ token, account, user, profile }) {
            if (profile?.sub)
                token.id = profile.sub // Google
            else if (profile?.id)
                token.id = profile.id // Other
            if (account)
                token.provider = account.provider
            return token
        },
        session({ session, token }) {
            session.user.id = token.id?.toString()
            session.user.provider = token.provider
            return session
        },
    },
})
