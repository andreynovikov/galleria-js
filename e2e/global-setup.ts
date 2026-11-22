import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import postgres from 'postgres'

import { authDir, dataDir, env, fixturesFolder, photosFolder, users } from './env'
import { bundles, settled } from './helpers'

const root = join(__dirname, '..')

/** Dates the copied photos back, as if copied a while ago: sync leaves files modified within the last minute */
async function settleFolder(folder: string) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
        const path = join(folder, entry.name)
        if (entry.isDirectory())
            await settleFolder(path)
        else
            await settled(path)
    }
}

async function createDatabase() {
    const sql = postgres({ database: 'postgres', onnotice: () => {} })
    try {
        const exists = await sql`SELECT 1 FROM pg_database WHERE datname = ${env.PGDATABASE}`
        if (exists.length === 0)
            await sql.unsafe(`CREATE DATABASE "${env.PGDATABASE}"`)
    } finally {
        await sql.end()
    }
}

async function resetSchema() {
    const sql = postgres({ onnotice: () => {} })
    try {
        await sql`DROP TABLE IF EXISTS log, label_image, label, visitor, image CASCADE`
        await sql.unsafe(await readFile(join(root, 'sql', 'schema.sql'), 'utf8')).simple()
        for (const user of Object.values(users))
            await sql`
              INSERT INTO visitor ${sql({
                  id: user.id,
                  provider: user.provider,
                  censorship: user.censorship,
                  data: sql.json({ name: user.name, email: user.email })
              })}
            `
    } finally {
        await sql.end()
    }
}

/** Imports bundles the same way the app does on first view (by calling its own sync code) */
async function syncBundles() {
    const { syncBundle } = await import('../lib/images')
    try {
        for (const bundle of bundles)
            await syncBundle(bundle)
    } finally {
        await global.__postgresSqlClient?.end()
        global.__postgresSqlClient = undefined
    }
    // Censorship can not be set from photo metadata
    const sql = postgres({ onnotice: () => {} })
    try {
        await sql`UPDATE image SET censored = 1 WHERE bundle = '/travel/Armenia/2016' AND name = 'IMG_0102.jpg'`
        await sql`UPDATE image SET censored = 1 WHERE bundle = '/hidden/2020'`
    } finally {
        await sql.end()
    }
}

/**
 * Creates Playwright storage states with Better Auth session cookies. They are made by a separate auth instance
 * with the app options (so cookie names and encryption match), which can sign in users without OAuth.
 */
async function createSessions() {
    const { betterAuth } = await import('better-auth')
    const { testUtils } = await import('better-auth/plugins')
    const { authOptions } = await import('../auth')
    const testAuth = betterAuth({
        ...authOptions,
        // The app sets visitor fields in a session hook, test sessions get them directly
        databaseHooks: undefined,
        // Cookie names depend on base URL: `__Secure-` prefix is used for https and, when it is not set, in production
        secret: env.AUTH_SECRET,
        baseURL: env.BETTER_AUTH_URL,
        plugins: [...authOptions.plugins, testUtils()]
    })
    const { test } = await testAuth.$context

    await mkdir(authDir, { recursive: true })
    for (const [key, user] of Object.entries(users)) {
        // As auth.ts keeps them: under an e-mail of the provider account, with the reported one in contactEmail
        const saved = await test.saveUser(test.createUser({
            name: user.name,
            email: `${user.provider}-${user.id}@accounts.invalid`,
            contactEmail: user.email
        }))
        const { headers, cookies } = await test.login({
            userId: saved.id,
            session: { visitorId: user.id, provider: user.provider, censorship: user.censorship }
        })
        // Stateless sessions are read from the encrypted `session_data` cookie, which is set by getSession
        const response = await testAuth.api.getSession({ headers, returnHeaders: true })
        const sessionData = response.headers.getSetCookie()
            .map(cookie => cookie.split(';')[0].split('='))
            .filter(([name]) => name.includes('session_data'))
            .map(([name, ...value]) => ({ ...cookies[0], name, value: value.join('=') }))
        if (sessionData.length === 0)
            throw new Error('Better Auth did not set session_data cookie')
        const state = { cookies: [...cookies, ...sessionData], origins: [] }
        await writeFile(join(authDir, `${key}.json`), JSON.stringify(state, null, 2))
    }
}

export default async function globalSetup() {
    // Photos are copied because the app writes thumbnails next to them and tests add and remove files
    await rm(dataDir, { recursive: true, force: true })
    await cp(join(fixturesFolder, 'photos'), photosFolder, { recursive: true })
    await settleFolder(photosFolder)

    await createDatabase()
    await resetSchema()
    await syncBundles()
    await createSessions()
}
