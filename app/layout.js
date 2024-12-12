import GaInit from 'components/gallery/ga-init'

import { Nunito } from 'next/font/google'

const nunito = Nunito({
    subsets: ['latin', 'cyrillic'],
    display: 'block',
})

import 'modern-normalize/modern-normalize.css'
import './globals.scss'

export default function RootLayout({ children }) {
    return (
        <html lang="en" className={nunito.className}>
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
