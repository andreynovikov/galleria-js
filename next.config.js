module.exports = {
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
    }
}
