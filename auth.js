import NextAuth from 'next-auth'
import GitHub from 'next-auth/providers/github'
import Google from 'next-auth/providers/google'
import MailRu from 'next-auth/providers/mailru'
import Vk from 'next-auth/providers/vk'
import Yandex from 'next-auth/providers/yandex'

const basePath = process.env.BASE_PATH ?? ''

export const { auth, handlers, signIn, signOut } = NextAuth({
    basePath: `${basePath}/api/auth`,
    providers: [
        GitHub,
        Google,
        MailRu,
        Vk,
        Yandex
    ],
    callbacks: {
        jwt({ token, account, user, profile }) {
            console.log('user', user)
            console.log('profile', profile)
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
            console.log('session', session)
            return session
        },
    },
})
