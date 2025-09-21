import { NextConfig } from 'next'
import webpack from 'webpack'

/**
 * Webpack config modification adopted from https://github.com/vercel/next.js/issues/11629
 */
const regexEqual = (x: RegExp, y: RegExp) => {
    return (
        x.source === y.source &&
        x.global === y.global &&
        x.ignoreCase === y.ignoreCase &&
        x.multiline === y.multiline
    )
}

const nextConfig: NextConfig = {
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
    webpack: (config: webpack.Configuration) => {
        const oneOf = config.module?.rules?.find(
            rule => rule !== null && typeof rule === 'object' && typeof rule.oneOf === 'object'
        ) as webpack.RuleSetRule

        if (oneOf) {
            const sassRule = oneOf.oneOf?.find(
                rule => typeof rule === 'object' && rule?.test instanceof RegExp && regexEqual(rule?.test, /\.module\.(scss|sass)$/)
            ) as webpack.RuleSetRule
            if (sassRule) {
                const sassLoader = Array.isArray(sassRule?.use) && sassRule.use.find(
                    el => el && typeof el === 'object' && el.loader?.includes('next/dist/compiled/sass-loader')
                )
                if (sassLoader && typeof sassLoader === 'object') {
                    sassLoader.loader = 'sass-loader'
                }
            }
        }

        return config
    }
}

export default nextConfig