import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'

import { providers } from '@/auth'
import SignIn from '@/components/signin'
import { param } from '@/lib/utils'

const basePath = process.env.BASE_PATH ?? ''

export async function generateMetadata(): Promise<Metadata> {
    return {
        title: (await getTranslations('Titles'))('signIn'),
        robots: { index: false }
    }
}

/** Messages of the error codes which Better Auth appends to `errorURL`; other codes get `failed` */
const errors = {
    access_denied: 'access_denied',
    email_not_found: 'email_not_found',
    state_mismatch: 'state_expired',
    state_not_found: 'state_expired'
} as const

/** Only local paths are accepted, so the page can not be used as an open redirect */
function localPath(url: string | undefined) {
    if (url?.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\'))
        return url
    return `${basePath}/`
}

export default async function SignInPage(props: PageProps<'/signin'>) {
    const searchParams = await props.searchParams
    const callbackUrl = localPath(param(searchParams, 'callbackUrl'))
    const error = param(searchParams, 'error')
    const t = await getTranslations('SignIn')

    return (
        <SignIn
            // Translations may name a provider differently, such as Яндекс for Yandex
            providers={providers.map(({ id, name }) => ({ id, name: t('provider', { id, name }) }))}
            callbackUrl={callbackUrl}
            // The code comes from the query string, so it is looked up only among the object's own keys
            error={error === undefined ? undefined : t(`errors.${Object.hasOwn(errors, error) ? errors[error as keyof typeof errors] : 'failed'}`)}
            basePath={basePath}
        />
    )
}
