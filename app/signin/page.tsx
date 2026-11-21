import type { Metadata } from 'next'

import { providers } from '@/auth'
import SignIn from '@/components/signin'
import { param } from '@/lib/utils'

const basePath = process.env.BASE_PATH ?? ''

export const metadata: Metadata = {
    title: 'Вход',
    robots: { index: false }
}

/** Error codes which Better Auth appends to `errorURL` */
const errors: Record<string, string> = {
    access_denied: 'Вход отменён.',
    email_not_found: 'Не удалось получить адрес электронной почты от провайдера.',
    state_mismatch: 'Сессия входа устарела, попробуйте ещё раз.',
    state_not_found: 'Сессия входа устарела, попробуйте ещё раз.'
}

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

    return (
        <SignIn
            providers={providers.map(({ id, name }) => ({ id, name }))}
            callbackUrl={callbackUrl}
            error={error === undefined ? undefined : errors[error] ?? 'Не удалось войти, попробуйте ещё раз.'}
            basePath={basePath}
        />
    )
}
