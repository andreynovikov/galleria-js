/**
 * Webpack config modification adopted from https://github.com/vercel/next.js/issues/11629
 */
const regexEqual = (x, y) => {
    return (
        x instanceof RegExp &&
        y instanceof RegExp &&
        x.source === y.source &&
        x.global === y.global &&
        x.ignoreCase === y.ignoreCase &&
        x.multiline === y.multiline
    )
}

const nextConfig = {
    basePath: process.env.BASE_PATH,
    output: 'standalone',
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
    },
    experimental: {
        after: true
    },
    webpack: config => {
        const oneOf = config.module.rules.find(
            rule => typeof rule.oneOf === 'object'
        )

        if (oneOf) {
            const sassRule = oneOf.oneOf.find(rule => regexEqual(rule.test, /\.module\.(scss|sass)$/))
            if (sassRule) {
                const sassLoader = sassRule.use.find(
                    el => el.loader.includes('next/dist/compiled/sass-loader')
                )
                if (sassLoader) {
                    sassLoader.loader = 'sass-loader'
                }
            }
        }

        return config
    }
}

export default nextConfig