import { join } from 'node:path'

import { loadEnvConfig } from '@next/env'

const root = join(__dirname, '..')

// Load .env/.env.local like Next does, so local PostgreSQL connection settings (PGHOST, PGUSER, ...) are reused.
// Everything that matters for the tests is overridden below.
loadEnvConfig(root, false, { info: () => {}, error: console.error })

export const port = Number(process.env.E2E_PORT ?? 3100)
export const baseURL = `http://localhost:${port}`

export const dataDir = join(root, 'e2e', '.data')
export const photosFolder = join(dataDir, 'photos')
export const fixturesFolder = join(root, 'e2e', 'fixtures')
export const authDir = join(dataDir, 'auth')

export const users = {
    user: {
        id: 'e2e-user',
        provider: 'github',
        name: 'E2E User',
        email: 'user@example.com',
        censorship: 1
    },
    admin: {
        id: 'e2e-admin',
        provider: 'github',
        name: 'E2E Admin',
        email: 'admin@example.com',
        censorship: 1
    }
}

export const env: Record<string, string> = {
    TZ: 'UTC', // the same as in Docker, timestamps are stored as UTC wall-clock time
    PGDATABASE: process.env.E2E_PGDATABASE ?? 'galleria_e2e',
    PHOTOS_FOLDER: photosFolder,
    RESTRICTED_LABELS: 'Private',
    ADMIN_ID: users.admin.id,
    // Test-only secret, random enough to not trigger Better Auth entropy warning
    AUTH_SECRET: 'e2e-7f3c9a1d5b8e2f6a0c4d9b7e1a3f5c8d2b6e0a4f',
    BETTER_AUTH_URL: baseURL,
    // Providers are never contacted, but they need some configuration to be listed on the sign-in page
    AUTH_GITHUB_ID: 'e2e', AUTH_GITHUB_SECRET: 'e2e',
    AUTH_GOOGLE_ID: 'e2e', AUTH_GOOGLE_SECRET: 'e2e',
    AUTH_MAILRU_ID: 'e2e', AUTH_MAILRU_SECRET: 'e2e',
    AUTH_VK_ID: 'e2e', AUTH_VK_SECRET: 'e2e',
    AUTH_YANDEX_ID: 'e2e', AUTH_YANDEX_SECRET: 'e2e',
    // Do not report test traffic
    GOOGLE_ANALYTICS_ID: '',
    GOOGLE_ANALYTICS_API_SECRET: '',
    NEXT_TELEMETRY_DISABLED: '1'
}

if (!/e2e|test/i.test(env.PGDATABASE))
    throw new Error(`Refusing to run tests against database "${env.PGDATABASE}": its name must contain "e2e" or "test", because tests drop all tables`)

// Apply to the test runner process too (global setup and specs access the database and photos folder directly)
Object.assign(process.env, env)
