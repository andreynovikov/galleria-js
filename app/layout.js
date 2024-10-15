import { Nunito } from 'next/font/google'

const nunito = Nunito({
    subsets: ['latin', 'cyrillic'],
    display: 'swap',
})

import 'modern-normalize/modern-normalize.css'
import './globals.css'

export default function RootLayout({ children }) {
    return (
        <html lang="en" className={nunito.className}>
            <body>{children}</body>
        </html>
    )
}
