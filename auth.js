import NextAuth from 'next-auth'
import GitHub from 'next-auth/providers/github'
import Google from 'next-auth/providers/google'
import MailRu from 'next-auth/providers/mailru'
import Vk from 'next-auth/providers/vk'
import Yandex from 'next-auth/providers/yandex'

export const { auth, handlers, signIn, signOut } = NextAuth({
    providers: [
        GitHub,
        Google,
        MailRu,
        Vk,
        Yandex
    ],
    callbacks: {
        jwt({ token, account, user, profile }) {
            console.log(user)
            console.log(profile)
            if (profile?.sub)
                token.id = profile.sub // Google
            else if (profile?.id)
                token.id = profile.id
            if (account)
                token.provider = account.provider
            return token
        },
        session({ session, token }) {
            session.user.id = token.id
            session.user.provider = token.provider
            return session
        },
    },
})
