import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
    basePath: process.env.BASE_PATH,
    output: 'standalone',
    // exifr loads fs/zlib with dynamic require() which does not work when bundled
    serverExternalPackages: ['exifr'],
    async headers() {
        const getHighEntropyValues = 'Sec-CH-UA-Full-Version-List, Sec-CH-UA-Mobile, Sec-CH-UA-Model, Sec-CH-UA-Platform, Sec-CH-UA-Platform-Version, Sec-CH-UA-Arch, Sec-CH-UA-Bitness'
        return [
            {
                source: '/:path*',
                headers: [
                    {
                        key: 'accept-ch',
                        value: getHighEntropyValues
                    },
                    {
                        key: 'critical-ch',
                        value: getHighEntropyValues
                    }
                ]
            }
        ]
    }
}

export default nextConfig
