import { headers } from 'next/headers'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale } from 'next-intl/server'

import GaInit from '@/components/gallery/ga-init'

import { Nunito } from 'next/font/google'

// Text is shown at once in a fallback font whose metrics next/font adjusts to Nunito, so the swap barely shifts it
const nunito = Nunito({
    subsets: ['latin', 'cyrillic'],
    display: 'swap',
})

import 'modern-normalize/modern-normalize.css'
import './globals.css'

export default async function RootLayout({ children }: LayoutProps<'/'>) {
    // Set by proxy.ts. Reading it renders every page per request, which the nonce needs anyway: a page rendered
    // ahead would have none, and its scripts would be blocked
    const nonce = (await headers()).get('x-nonce') ?? undefined

    // The provider passes the language, messages and time zone of i18n/request.ts on to client components
    return (
        <html lang={await getLocale()} className={nunito.className}>
            <body>
                <NextIntlClientProvider>
                    {children}
                </NextIntlClientProvider>
                <footer>
                    Powered by <a href="https://github.com/andreynovikov/galleria-js" target="_blank">galleria-js</a>
                </footer>
            </body>
            {process.env.GOOGLE_ANALYTICS_ID && <GaInit gaId={process.env.GOOGLE_ANALYTICS_ID} basePath={process.env.BASE_PATH ?? ''} nonce={nonce} />}
        </html>
    )
}
