import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import postgres from 'postgres'
import { encode } from 'next-auth/jwt'

import { authDir, baseURL, dataDir, env, fixturesFolder, photosFolder, users } from './env'
import { bundles } from './helpers'

const root = join(__dirname, '..')

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
    } finally {
        await sql.end()
    }
}

/** Creates Playwright storage states with forged Auth.js session cookies */
async function createSessions() {
    await mkdir(authDir, { recursive: true })
    const cookieName = 'authjs.session-token' // not __Secure- prefixed, because tests run over plain HTTP
    for (const [key, user] of Object.entries(users)) {
        const visitor = { id: user.id, provider: user.provider, censorship: user.censorship, name: user.name, email: user.email }
        const value = await encode({
            salt: cookieName,
            secret: env.AUTH_SECRET,
            // The same token as created by `jwt` callback in auth.ts
            token: { name: user.name, email: user.email, sub: user.id, visitor }
        })
        const state = {
            cookies: [{
                name: cookieName,
                value,
                domain: new URL(baseURL).hostname,
                path: '/',
                expires: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
                httpOnly: true,
                secure: false,
                sameSite: 'Lax' as const
            }],
            origins: []
        }
        await writeFile(join(authDir, `${key}.json`), JSON.stringify(state, null, 2))
    }
}

export default async function globalSetup() {
    // Photos are copied because the app writes thumbnails next to them and tests add and remove files
    await rm(dataDir, { recursive: true, force: true })
    await cp(join(fixturesFolder, 'photos'), photosFolder, { recursive: true })

    // Label maps are cached with unstable_cache, which survives server restarts
    await rm(join(root, '.next', 'cache', 'fetch-cache'), { recursive: true, force: true })

    await createDatabase()
    await resetSchema()
    await syncBundles()
    await createSessions()
}
