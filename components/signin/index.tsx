'use client'

import { useMemo, useState } from 'react'

import { createAuthClient } from 'better-auth/client'

import styles from './signin.module.css'

interface SignInProps {
    providers: { id: string, name: string }[]
    callbackUrl: string
    error?: string
    basePath: string
}

export default function SignIn({ providers, callbackUrl, error, basePath }: SignInProps) {
    const authClient = useMemo(() => createAuthClient({ basePath: `${basePath}/api/auth` }), [basePath])
    const [pending, setPending] = useState<string>()
    const [failure, setFailure] = useState(error)

    const signIn = async (provider: string) => {
        setPending(provider)
        setFailure(undefined)
        const errorCallbackURL = `${basePath}/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`
        // On success the client follows the provider authorization URL
        const { error } = await authClient.signIn.social({ provider, callbackURL: callbackUrl, errorCallbackURL })
        if (error) {
            setPending(undefined)
            setFailure(error.message ?? 'Не удалось войти, попробуйте ещё раз.')
        }
    }

    return (
        <div className={styles.container}>
            <h2>Вход</h2>
            {failure && <p className={styles.error} role="alert">{failure}</p>}
            <div className={styles.providers}>
                {providers.map(provider => (
                    <button
                        key={provider.id}
                        className="button"
                        disabled={pending !== undefined}
                        onClick={() => signIn(provider.id)}>
                        Войти через {provider.name}
                    </button>
                ))}
            </div>
        </div>
    )
}
