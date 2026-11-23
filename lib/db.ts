import postgres, { type Fragment, type Sql } from 'postgres'

type JSONValue = postgres.JSONValue

declare global {
    var __postgresSqlClient: Sql | undefined
    var __listings: Map<string, { expires: number, value: Promise<unknown> }> | undefined
}

/**
 * The connection comes from the libpq env vars. Its session is in UTC whatever the server's `TimeZone` is, so
 * `now()` and casts between `timestamp` and `timestamptz` give UTC wall-clock time, as `timestamp` columns hold it.
 */
const connect = () => postgres({ connection: { TimeZone: 'UTC' } })

let sql: Sql

if (process.env.NODE_ENV === 'production') {
    sql = connect()
} else {
    if (!global.__postgresSqlClient) {
        global.__postgresSqlClient = connect()
    }
    sql = global.__postgresSqlClient
}

export interface ImageRecord {
    id: number
    name: string
    bundle: string
    width: number
    height: number
    orientation: number
    stime: Date | null
    author: number | null
    description: string | null
    lat6: number | null
    lon6: number | null
    ctime: Date | null
    mtime: Date | null
    starred: number
    exportable: boolean
    censored: number
    /** `null` until read from the file, `{}` when it has none */
    exif: CameraSettings | null
    /** File size when the metadata was read (with `mtime`), `null` for photos imported before it was recorded */
    size: number | null
}

export type ImageUpdate = Partial<Pick<ImageRecord, 'width' | 'height' | 'orientation' | 'description' | 'stime' | 'exif' | 'size' | 'mtime'>>

/** Camera settings shown in the lightbox, named as the EXIF tags */
export type CameraSettings = {
    FocalLength?: number
    ISO?: number
    ExposureTime?: number
    FNumber?: number
}

export interface Label {
    id: number
    name: string
}

export interface LabelCount extends Label {
    count: number
}

export interface Bundle {
    path: string
    count: number
}

export interface ListedImage {
    id: number
    name: string
    bundle: string
    description?: string | null
    width: number
    height: number
    restricted?: boolean
}

export interface ImageFilters {
    bundle?: string
    from?: Date
    till?: Date
    labels?: number[]
    notlabels?: number[]
    /** Highest censorship level of listed images */
    censored: number
}

export interface Visitor {
    id: string
    provider: string
    censorship: number
    name?: string | null
    email?: string | null
    image?: string | null
}

/** Identifies (possibly anonymous) visitor in logs */
export interface VisitorRef {
    id?: string | null
    provider?: string | null
}

/**
 * Admins from `ADMIN_ID`, given as comma-separated `provider:id` pairs. Account ids are only unique within
 * a provider (most of them are plain numbers), so entries without a provider are ignored.
 */
const adminIds = new Set((process.env.ADMIN_ID ?? '').split(',').map(admin => admin.trim()).filter(admin => {
    if (/^[^:]+:.+$/.test(admin))
        return true
    if (admin !== '')
        console.warn(`Ignoring ADMIN_ID entry "${admin}": admins must be given as provider:id`)
    return false
}))

/** Whether the visitor is listed in `ADMIN_ID` */
export function isAdminVisitor(visitor?: VisitorRef | null) {
    return !!visitor?.id && !!visitor.provider && adminIds.has(`${visitor.provider}:${visitor.id}`)
}

export type LogMeta = { [key: string]: JSONValue | undefined }

export interface LogFilters {
    from?: Date
    label?: number
    status?: number
}

export interface LogUser {
    ip: string
    day: Date
    count: number
    visitors: { name?: string | null, email?: string | null }[]
    meta: { browser?: { name?: string, major?: string, type?: string }, device?: { vendor?: string, model?: string, type?: string }, ua?: string }[]
}

export interface UserLogFilters extends Pick<LogFilters, 'label' | 'status'> {
    ip: string
    /** `YYYY-MM-DD` */
    day?: string
}

export interface UserLogImage {
    id: number
    bundle: string
    name: string
    width: number
    height: number
    status: number
    last_time: Date
    visitor_id: string | null
    visitor_provider: string | null
    visitor: { name?: string, email?: string, image?: string, [key: string]: unknown } | null
    meta: ({ zoom?: number } | null)[]
    day?: Date
}

const restrictedLabels = process.env.RESTRICTED_LABELS?.split(',') ?? []

/** Resolves label ids and names (as given in `-filt.labels` or RESTRICTED_LABELS) to ids, unknown names are left out */
export async function resolveLabels(values: string[]) {
    const ids = values.filter(value => !isNaN(+value)).map(Number)
    const names = values.filter(value => isNaN(+value))
    if (names.length > 0) {
        const rows = await sql<{ id: number }[]>`
          SELECT id FROM label
          WHERE name IN ${sql(names)}
        `
        ids.push(...rows.map(row => row.id))
    }
    return [...new Set(ids.filter(id => Number.isInteger(id) && id > 0))]
}

/**
 * Ids of RESTRICTED_LABELS. They are looked up on every call (by the unique name index): album sync creates and
 * deletes labels, so the ids change, and a stale list would show restricted photos unblurred.
 */
export async function getRestrictedLabels() {
    return restrictedLabels.length > 0 ? await resolveLabels(restrictedLabels) : []
}

/** Names of labels by id */
export async function getLabelNames(ids: number[]) {
    if (ids.length === 0)
        return {}
    const rows = await sql<Label[]>`
      SELECT id, name FROM label
      WHERE id IN ${sql(ids)}
    `
    return Object.fromEntries(rows.map(row => [String(row.id), row.name]))
}

// helpers (https://github.com/porsager/postgres/discussions/529)
const and = (arr: Fragment[]) => arr.reduce((acc, x) => sql`${acc} AND ${x}`)

/**
 * Album and label lists of the landing page, kept in memory by censorship level. Kept on `globalThis`, so every module
 * instance in the server process shares them. Writes of photos and their labels below clear them; the lifetime covers
 * changes made outside the app, such as censorship levels set in the database by hand.
 */
const listings = global.__listings ??= new Map()
const listingLifetime = 5 * 60 * 1000

function cachedListing<T>(key: string, load: () => Promise<T>): Promise<T> {
    const cached = listings.get(key)
    if (cached !== undefined && cached.expires > Date.now())
        return cached.value as Promise<T>
    const entry = { expires: Date.now() + listingLifetime, value: load() }
    listings.set(key, entry)
    entry.value.catch(() => {
        // An invalidation may have replaced this entry while its query was pending; leave the newer one intact.
        if (listings.get(key) === entry)
            listings.delete(key)
    })
    return entry.value
}

/** Called after every committed change to photos or their labels */
function invalidateListings() {
    listings.clear()
}

/** Albums with the number of photos the visitor may see; albums of censored photos only are left out */
export async function listBundles(censored: number) {
    return await cachedListing(`bundles:${censored}`, () => sql<Bundle[]>`
      SELECT
        bundle AS path,
        COUNT(id)::int AS count
      FROM image
      WHERE censored <= ${censored}
      GROUP BY bundle
      ORDER BY path
    `)
}

/** Labels with the number of photos the visitor may see; labels of censored photos only are left out */
export async function listLabels(censored: number) {
    return await cachedListing(`labels:${censored}`, () => sql<LabelCount[]>`
      SELECT
        label.id,
        label.name,
        COUNT(*)::int AS count
      FROM label
      JOIN label_image ON label_image.label = label.id
      JOIN image ON image.id = label_image.image
      WHERE image.censored <= ${censored}
      GROUP BY label.id
      ORDER BY label.name ASC
    `)
}

/**
 * Labels of the photos which have all `include` labels and none of `exclude`, with the number of such photos the
 * visitor may see. The matching photos are found with index lookups per label instead of grouping all of
 * `label_image`.
 */
export async function listRelatedLabels(include: number[], exclude: number[], censored: number) {
    if (include.length === 0)
        return [] // never output all labels

    const intersection = include
        .map(label => sql`SELECT image FROM label_image WHERE label = ${label}`)
        .reduce((acc, x) => sql`${acc} INTERSECT ${x}`)
    // Faster than EXCEPT, which collects every photo of the excluded labels first
    const matching = exclude.length === 0 ? intersection : sql`
      SELECT image FROM (${intersection}) included
      WHERE NOT EXISTS (
        SELECT 1 FROM label_image excluded
        WHERE excluded.image = included.image AND excluded.label = ANY(${exclude}::int[])
      )
    `
    const selected = [...include, ...exclude]

    return await sql<LabelCount[]>`
      WITH matching AS (${matching})
      SELECT
        label.id,
        label.name,
        COUNT(*)::int AS count
      FROM matching
      JOIN image ON image.id = matching.image
      JOIN label_image ON label_image.image = matching.image
      JOIN label ON label.id = label_image.label
      WHERE image.censored <= ${censored} AND label_image.label <> ALL(${selected}::int[])
      GROUP BY label.id
      ORDER BY count DESC, label.name ASC
    `
}

/** Columns photos can be listed by (`-nav.order`): shooting time, import time and file name */
const imageOrders = ['stime', 'ctime', 'name'] as const
type ImageOrderColumn = typeof imageOrders[number]
/** A column, or a column after `-` for the reverse order */
export type ImageOrder = ImageOrderColumn | `-${ImageOrderColumn}`

/** The order asked for, or by shooting time when it is missing or unknown, so old or mistyped links still work */
export function parseImageOrder(value: string | undefined): ImageOrder {
    const column = value?.startsWith('-') ? value.slice(1) : value
    return (imageOrders as readonly (string | undefined)[]).includes(column) ? value as ImageOrder : 'stime'
}

export async function listImages(filters: ImageFilters, order: ImageOrder) {
    const restrictedLabels = await getRestrictedLabels()

    const where = [sql`width > 0`] // list only images with width, otherwise ReactPhotoAlbum gets broken

    if (filters.bundle)
        where.push(sql`bundle = ${filters.bundle}`)

    if (filters.from)
        where.push(sql`stime >= ${filters.from}`)
    if (filters.till)
        where.push(sql`stime <= ${filters.till}`)

    // Test membership across all labels of each photo: filtering join rows in WHERE would lose other matches.
    const labels: Fragment[] = []
    if (filters.labels && filters.labels.length > 0)
        labels.push(...filters.labels.map(label => sql`SUM(CASE WHEN label=${label} THEN 1 ELSE 0 END) > 0`))
    if (filters.notlabels && filters.notlabels.length > 0)
        labels.push(...filters.notlabels.map(label => sql`SUM(CASE WHEN label=${label} THEN 1 ELSE 0 END) = 0`))

    if (labels.length > 0)
        where.push(sql`label_image.label IS NOT NULL`)

    if (where.length === 1)
        return [] // never output all images

    where.push(sql`censored <= ${filters.censored}`)

    const direction = order.startsWith('-') ? sql`DESC` : sql`ASC`
    const orderBy = (order.startsWith('-') ? order.slice(1) : order) as ImageOrderColumn

    let join = sql``
    let group = sql``
    if (labels.length > 0) {
        join = sql`INNER JOIN label_image ON (id = image)`
        group = sql`GROUP BY id`
    } else if (restrictedLabels.length > 0) {
        join = sql`LEFT JOIN label_image ON (id = image)`
        group = sql`GROUP BY id`
    }

    // Stable tie-breakers keep lightbox indices consistent when photos share a shooting time or filename.
    const images = await sql<ListedImage[]>`
      SELECT
        id,
        name,
        bundle,
        description,
        width,
        height
      ${restrictedLabels.length > 0 ? sql`,
        array_agg(label_image.label) && ${restrictedLabels}::int[] AS restricted
      ` : sql``}
      FROM image
      ${join}
      WHERE ${and(where)}
      ${group}
      ${labels.length > 0 ? sql`
      HAVING ${and(labels)}
      ` : sql``}
      ORDER BY ${sql(orderBy)} ${direction}, name ${direction}, id ${direction}
    `
    return images
}

export async function getBundleImages(bundle: string) {
    const images = await sql<Pick<ImageRecord, 'id' | 'name' | 'size' | 'mtime'>[]>`
      SELECT
        id,
        name,
        size,
        mtime
      FROM image
      WHERE bundle = ${bundle}
    `
    return images
}

/** Albums in the database at `under` or below it (a bundle path, `''` for all) */
export async function listBundlePaths(under: string) {
    const rows = await sql<{ bundle: string }[]>`
      SELECT DISTINCT bundle FROM image
      ${under === '' ? sql`` : sql`WHERE bundle = ${under} OR starts_with(bundle, ${under + '/'})`}
    `
    return rows.map(row => row.bundle)
}

/** Deletes all photos of an album whose folder is gone */
export async function deleteBundleImages(bundle: string) {
    try {
        await sql`DELETE FROM image WHERE bundle = ${bundle}`
    } finally {
        invalidateListings()
    }
}

/**
 * Sample candidate ids before joining photos, avoiding a random sort of the whole archive. Gaps in the id range,
 * duplicate candidates and censorship filtering can yield fewer than `limit` photos, even with oversampling.
 */
export async function getRandomImages(limit: number, censored: number) {
    const restrictedLabels = await getRestrictedLabels()
    const hasRestricted = restrictedLabels.length > 0

    const images = await sql<ListedImage[]>`
      WITH params AS (
        SELECT
          min(id) AS min_id,
          max(id) - min(id) AS id_span
        FROM image
      )
      SELECT
        id,
        name,
        bundle,
        width,
        height
        ${hasRestricted ? sql`,
        array_agg(label_image.label) && ${restrictedLabels}::int[] AS restricted
        ` : sql``}
      FROM (
        SELECT p.min_id + trunc(random() * p.id_span)::integer AS id
        FROM params p, generate_series(1, ${Math.round(limit * 1.2)}) g
        GROUP BY 1
      ) r
      JOIN image USING (id)
      ${hasRestricted ? sql`
      LEFT JOIN label_image ON (id = image)
      ` : sql``}
      WHERE width > 0 AND censored <= ${censored}
      ${hasRestricted ? sql`
      GROUP BY id, name, bundle, width, height
      ` : sql``}
      ORDER BY random()
      LIMIT ${limit};
    `
    return images
}

export async function getImageById(id: number) {
    const result = await sql<ImageRecord[]>`
      SELECT * FROM image
      WHERE id = ${id}
    `
    return result.at(0)
}

/** Photos with the given ids, in no particular order; missing ids are left out */
export async function getImagesByIds(ids: number[]) {
    return await sql<ImageRecord[]>`
      SELECT * FROM image
      WHERE id = ANY(${ids}::int[])
    `
}

export async function getImageByName(bundle: string, name: string) {
    const result = await sql<ImageRecord[]>`
      SELECT * FROM image
      WHERE bundle = ${bundle} AND name = ${name}
    `
    return result.at(0)
}

/** Columns of a photo update, with JSON values wrapped for postgres */
function imageColumns({ exif, ...data }: ImageUpdate) {
    return exif === undefined ? data : { ...data, exif: exif === null ? null : sql.json(exif) }
}

/**
 * Inserts a photo with its labels in one transaction. Returns its id, or `undefined` if the photo is already there
 * (another sync of the same album added it meanwhile).
 */
export async function addImage(bundle: string, name: string, data: ImageUpdate, labels: number[]) {
    return sql.begin(async sql => {
        const image = { bundle, name, ctime: new Date().toISOString(), ...imageColumns(data) }
        const [row] = await sql<{ id: number }[]>`
          INSERT INTO image ${sql(image)}
          ON CONFLICT (bundle, name) DO NOTHING
          RETURNING id
        `
        if (row !== undefined && labels.length > 0)
            await sql`
              INSERT INTO label_image ${sql(labels.map(label => ({ image: row.id, label })))}
            `
        return row?.id
    }).finally(invalidateListings)
}

export async function updateImage(id: number, data: ImageUpdate) {
    await sql`
      UPDATE image SET ${sql(imageColumns(data))}
      WHERE id = ${id}
    `
}

export async function deleteImage(id: number) {
    // Other tables are cascaded via DB constraint
    try {
        await sql`
          DELETE FROM image
          WHERE id = ${id}
        `
    } finally {
        invalidateListings()
    }
}

export async function getImageLabels(id: number) {
    const labels = await sql<Label[]>`
      SELECT id, name FROM label
      INNER JOIN label_image ON (id = label AND image = ${id})
    `
    return labels
}

export async function setImageLabels(id: number, labels: number[]) {
    const current = (await sql<{ label: number }[]>`
      SELECT label FROM label_image
      WHERE image = ${id}
    `).map(r => r.label)
    const toBeAdded = labels.filter(l => !current.includes(l))
    const toBeDeleted = current.filter(l => !labels.includes(l))
    await sql.begin(async sql => {
        if (toBeAdded.length > 0) {
            const imageLabels = toBeAdded.map(label => (
                {
                    image: id,
                    label
                }
            ))
            await sql`
              INSERT INTO label_image ${sql(imageLabels)}
            `
        }
        if (toBeDeleted.length > 0) {
            await sql`
              DELETE FROM label_image
              WHERE image = ${id} AND label in ${sql(toBeDeleted)}
            `
            // If label is not used anymore, delete it permanently
            const unused = await sql<{ id: number }[]>`
              SELECT
                id
              FROM label
              LEFT JOIN label_image ON (id = label)
              WHERE id IN ${sql(toBeDeleted)}
              GROUP BY id
              HAVING COUNT(image) = 0
            `
            if (unused.length > 0)
                await sql`
                  DELETE FROM label
                  WHERE id IN ${sql(unused.map(row => row.id))}
                `
        }
    }).finally(invalidateListings)
}

/** Ids of labels by name, creating the missing ones: two queries for any number of labels */
export async function getLabelIds(labels: string[]) {
    const names = [...new Set(labels)]
    if (names.length === 0)
        return []
    // Albums can be synced concurrently, so a label may be created by another sync at the same time
    await sql`
      INSERT INTO label ${sql(names.map(name => ({ name })))}
      ON CONFLICT (name) DO NOTHING
    `
    const rows = await sql<{ id: number }[]>`
      SELECT id FROM label
      WHERE name IN ${sql(names)}
    `
    return rows.map(row => row.id)
}

export async function getUser(id: string, provider: string, userData: object): Promise<Visitor> {
    const data: Record<string, JSONValue | undefined> = { ...userData }
    delete data['id'] // drop dynamic user id
    // Only new visitors get the default level; repeat sign-ins refresh the profile without changing access.
    const censorship = 1
    const result = await sql<(Omit<Visitor, 'name' | 'email' | 'image'> & { data: Record<string, JSONValue> })[]>`
      INSERT INTO visitor ${sql({ id, provider, censorship, data: sql.json(data) })}
      ON CONFLICT (id, provider) DO UPDATE SET
      (data) = ROW(EXCLUDED.data)
      RETURNING *
    `

    const { data: profile, ...visitor } = result[0]
    return {
        ...profile,
        ...visitor
    }
}

export async function writeLog(image: number, status: number, ip: string, visitor?: VisitorRef | null, meta: LogMeta | null = null) {
    if (isAdminVisitor(visitor))
        return
    const entry = {
        image,
        status,
        ip,
        visitor_id: visitor?.id ?? null,
        visitor_provider: visitor?.provider ?? null,
        ctime: new Date(),
        meta: meta === null ? null : sql.json(meta)
    }
    try {
        await sql`INSERT INTO log ${sql(entry)}`
    } catch (e) {
        // The photo was deleted by a sync meanwhile: its log rows are deleted with it anyway
        if (e instanceof postgres.PostgresError && e.constraint_name === 'log_image_fkey')
            return
        throw e
    }
}

/** Days of `/history` per page */
const historyPageDays = 7

/**
 * Visitors (by IP and day) of one page of `/history`: the week ending with the latest log entry before `before`
 * (a `YYYY-MM-DD` date, or now). Pages hold whole days, and empty stretches are skipped. `next` is the `before` of
 * the following page, `null` after the last one.
 */
export async function getLogUsers(filters: LogFilters, before?: string): Promise<{ users: LogUser[], next: string | null }> {
    const where: Fragment[] = [sql`TRUE`]

    if (filters.from)
        where.push(sql`ctime >= ${filters.from}`)

    if (filters.label)
        where.push(sql`label = ${filters.label}`)

    if (filters.status !== undefined)
        where.push(sql`status <= ${filters.status}`)

    const join = filters.label ? sql`INNER JOIN label_image ON (log.image = label_image.image)` : sql``

    // The latest entry is an index lookup on log (ctime)
    const [{ last, start }] = await sql<{ last: string | null, start: string | null }[]>`
      SELECT
        to_char(max(ctime), 'YYYY-MM-DD') AS last,
        to_char(max(ctime)::date - ${historyPageDays - 1}::int, 'YYYY-MM-DD') AS start
      FROM log
      ${join}
      WHERE ${and(where)} ${before ? sql`AND ctime < ${before}::date` : sql``}
    `
    if (last === null || start === null)
        return { users: [], next: null }

    // Switch to json_object('browser': meta->'browser', 'device': meta->'device') in PostgreSQL 16
    const users = await sql<LogUser[]>`
      SELECT
        ip,
        ctime::date AS day,
        COUNT(DISTINCT log.image)::int AS count,
        COALESCE(
          jsonb_agg(
            DISTINCT jsonb_build_object('name', visitor.data->'name', 'email', visitor.data->'email')
          ) FILTER (WHERE visitor.id IS NOT NULL),
          '[]'
        ) AS visitors,
        jsonb_agg(
          DISTINCT jsonb_build_object('browser', meta->'browser', 'device', meta->'device', 'ua', meta->'ua')
        ) AS meta
      FROM log
      ${join}
      LEFT JOIN visitor ON (log.visitor_id = visitor.id AND log.visitor_provider = visitor.provider)
      WHERE ${and(where)} AND ctime >= ${start}::date AND ctime < ${last}::date + 1
      GROUP BY ip, day
      ORDER BY day DESC, ip
    `
    return { users, next: start }
}

export async function getUserLog(filters: UserLogFilters) {
    const where = [sql`ip = ${filters.ip}`]
    const group = ['image.id', 'visitor_id', 'visitor_provider']
    let day = sql``

    if (filters.day) {
        // A range rather than date(ctime), so that the (ip, ctime) index is used
        where.push(sql`log.ctime >= ${filters.day}::date AND log.ctime < ${filters.day}::date + 1`)
    } else {
        day = sql`, log.ctime::date AS day`
        group.push('day')
    }

    if (filters.label)
        where.push(sql`label = ${filters.label}`)

    if (filters.status !== undefined)
        where.push(sql`status <= ${filters.status}`)

    const images = await sql<UserLogImage[]>`
      SELECT
        image.id AS id,
        bundle,
        name,
        width,
        height,
        MIN(status) AS status,
        MAX(log.ctime) AS last_time,
        visitor_id,
        visitor_provider,
        (array_agg(visitor.data))[1] AS visitor,
        jsonb_agg(DISTINCT meta) AS meta
        ${day}
      FROM log
      INNER JOIN image ON (log.image = id)
      ${filters.label ? sql`
      INNER JOIN label_image ON (image.id = label_image.image)
      ` : sql``}
      LEFT JOIN visitor ON (log.visitor_id = visitor.id AND log.visitor_provider = visitor.provider)
      WHERE ${and(where)}
      GROUP BY ${sql(group)}
      ORDER BY last_time DESC
    `
    return images
}

/** Whether `log` is partitioned: databases created before monthly partitions need a migration */
export async function isLogPartitioned() {
    const [row] = await sql<{ relkind: string }[]>`SELECT relkind FROM pg_class WHERE oid = 'log'::regclass`
    return row?.relkind === 'p'
}

/** Names of the monthly partitions of `log` (`log_YYYY_MM`) */
export async function listLogPartitions() {
    const rows = await sql<{ name: string }[]>`
      SELECT c.relname AS name
      FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
      WHERE i.inhparent = 'log'::regclass
    `
    return rows.map(row => row.name).filter(name => /^log_\d{4}_\d{2}$/.test(name))
}

/**
 * Creates the partition `name` of `log` for `start` ≤ ctime < `end` (`YYYY-MM-DD` dates). Rows of that range in the
 * default partition are moved into it first: attaching fails while the default partition has any. The default
 * partition is locked meanwhile, so a row written at the same time can't land there.
 */
export async function createLogPartition(name: string, start: string, end: string) {
    if (!/^log_\d{4}_\d{2}$/.test(name) || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end))
        throw new Error(`Invalid log partition ${name} ${start} ${end}`)
    await sql.begin(async sql => {
        await sql`SET LOCAL lock_timeout = '10s'`
        await sql`LOCK TABLE log_default IN ACCESS EXCLUSIVE MODE`
        await sql`CREATE TABLE ${sql(name)} (LIKE log INCLUDING DEFAULTS)`
        await sql`
          WITH moved AS (
            DELETE FROM log_default
            WHERE ctime >= ${start}::timestamp AND ctime < ${end}::timestamp
            RETURNING *
          )
          INSERT INTO ${sql(name)} SELECT * FROM moved
        `
        // Bounds of a partition must be literals; they are checked above. Indexes and the foreign key are added.
        await sql.unsafe(`ALTER TABLE log ATTACH PARTITION ${name} FOR VALUES FROM ('${start}') TO ('${end}')`)
    })
}

/** Drops a monthly partition of `log` with all its rows */
export async function dropLogPartition(name: string) {
    if (!/^log_\d{4}_\d{2}$/.test(name))
        throw new Error(`Invalid log partition ${name}`)
    await sql.begin(async sql => {
        // Dropping locks `log` itself; better to try again tomorrow than to hold up log writes behind a long query
        await sql`SET LOCAL lock_timeout = '10s'`
        await sql`DROP TABLE ${sql(name)}`
    })
}

/** Deletes rows older than `before` from the default partition of `log`, which takes months without a partition */
export async function deleteOldDefaultLog(before: Date) {
    const result = await sql`DELETE FROM log_default WHERE ctime < ${before}`
    return result.count
}

