import { join } from 'node:path'

import { loadEnvConfig } from '@next/env'

const root = join(__dirname, '..')

// Load .env/.env.local like Next does, so local PostgreSQL connection settings (PGHOST, PGUSER, ...) are reused.
// Everything that matters for the tests is overridden below.
loadEnvConfig(root, false, { info: () => {}, error: console.error })

export const port = Number(process.env.E2E_PORT ?? 3100)
export const baseURL = `http://localhost:${port}`
/**
 * For the tests behind nginx (playwright.nginx.config.ts, `npm run test:e2e:nginx`): the app's base path, and the
 * origin of nginx, which is the public one. The main tests use neither.
 */
export const basePath = process.env.E2E_BASE_PATH ?? ''
export const publicURL = process.env.E2E_PUBLIC_URL ?? baseURL

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
    },
    /** Has the admin's account id, but from another provider */
    impostor: {
        id: 'e2e-admin',
        provider: 'vk',
        name: 'E2E Impostor',
        email: 'impostor@example.com',
        censorship: 1
    },
    /** Signed in, but not allowed to see censored photos */
    viewer: {
        id: 'e2e-viewer',
        provider: 'github',
        name: 'E2E Viewer',
        email: 'viewer@example.com',
        censorship: 0
    }
}

export const env: Record<string, string> = {
    TZ: 'UTC', // the same as in Docker, timestamps are stored as UTC wall-clock time
    PGDATABASE: process.env.E2E_PGDATABASE ?? 'galleria_e2e',
    PHOTOS_FOLDER: photosFolder,
    // No photo has `Secret` until e2e/sync.spec.ts adds one
    RESTRICTED_LABELS: 'Private,Secret',
    ADMIN_ID: `${users.admin.provider}:${users.admin.id}`,
    // Test-only secret, random enough to not trigger Better Auth entropy warning
    AUTH_SECRET: 'e2e-7f3c9a1d5b8e2f6a0c4d9b7e1a3f5c8d2b6e0a4f',
    // An origin: a path here would become Better Auth's base path
    BETTER_AUTH_URL: publicURL,
    BASE_PATH: basePath,
    // Providers are never contacted, but they need some configuration to be listed on the sign-in page
    AUTH_GITHUB_ID: 'e2e', AUTH_GITHUB_SECRET: 'e2e',
    AUTH_GOOGLE_ID: 'e2e', AUTH_GOOGLE_SECRET: 'e2e',
    AUTH_MAILRU_ID: 'e2e', AUTH_MAILRU_SECRET: 'e2e',
    AUTH_VK_ID: 'e2e', AUTH_VK_SECRET: 'e2e',
    AUTH_YANDEX_ID: 'e2e', AUTH_YANDEX_SECRET: 'e2e',
    // Tests run under the nonce policy, so a script it would block fails them (e2e/gallery.spec.ts)
    CSP_NONCE: 'enforce',
    // Tests sync albums themselves, a scan of the whole folder would race with the ones adding and removing files
    SYNC_INTERVAL_MINUTES: '0',
    // Do not report test traffic
    GOOGLE_ANALYTICS_ID: '',
    GOOGLE_ANALYTICS_API_SECRET: '',
    NEXT_TELEMETRY_DISABLED: '1'
}

if (!/e2e|test/i.test(env.PGDATABASE))
    throw new Error(`Refusing to run tests against database "${env.PGDATABASE}": its name must contain "e2e" or "test", because tests drop all tables`)

// Apply to the test runner process too (global setup and specs access the database and photos folder directly)
Object.assign(process.env, env)
