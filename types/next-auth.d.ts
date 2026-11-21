import type { DefaultSession } from 'next-auth'

import type { Visitor } from '@/lib/db'

declare module 'next-auth' {
    /** Session user is extended with visitor record (see `callbacks` in auth.ts) */
    interface Session {
        user: Partial<Visitor> & DefaultSession['user']
    }
}

declare module '@auth/core/jwt' {
    interface JWT {
        visitor?: Visitor
    }
}
