import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

const eslintConfig = defineConfig([
    ...nextVitals,
    ...nextTs,
    globalIgnores([
        '.next/**',
        '.docker/**',
        'next-env.d.ts',
        'e2e/.data/**',
        'playwright-report/**',
        'test-results/**',
        'blob-report/**',
    ]),
    {
        rules: {
            'react-hooks/exhaustive-deps': 'warn',
            '@typescript-eslint/no-unused-expressions': [
                'error',
                {
                    allowShortCircuit: true,
                    allowTernary: true,
                    allowTaggedTemplates: true,
                },
            ],
        },
    },
])

export default eslintConfig
