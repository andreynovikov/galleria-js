import GaInit from '@/components/gallery/ga-init'

import { Nunito } from 'next/font/google'

// Text is shown at once in a fallback font whose metrics next/font adjusts to Nunito, so the swap barely shifts it
const nunito = Nunito({
    subsets: ['latin', 'cyrillic'],
    display: 'swap',
})

import 'modern-normalize/modern-normalize.css'
import './globals.css'

export default function RootLayout({ children }: LayoutProps<'/'>) {
    return (
        <html lang="ru" className={nunito.className}>
            <body>
                {children}
                <footer>
                    Powered by <a href="https://github.com/andreynovikov/galleria-js" target="_blank">galleria-js</a>
                </footer>
            </body>
            {process.env.GOOGLE_ANALYTICS_ID && <GaInit gaId={process.env.GOOGLE_ANALYTICS_ID} />}
        </html>
    )
}
