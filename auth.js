import NextAuth from 'next-auth'

import { getUser } from 'lib/db'
import { sendEvent } from 'lib/ga'

import authConfig from './auth.config'

export const { auth, handlers, signIn, signOut } = NextAuth({
    ...authConfig,
    callbacks: {
        async jwt({ token, account, user }) {
            if (account)
                token.visitor = await getUser(account.providerAccountId, account.provider, user)
            return token
        },
        session({ session, token }) {
            session.user = { ...session.user, ...token.visitor }
            return session
        }
    },
    events: {
        async signIn({ account }) {
            await sendEvent('login', { 'method': account.provider })
        }
    }
})
