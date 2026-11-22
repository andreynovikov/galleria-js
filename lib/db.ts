import postgres, { type Fragment, type Sql } from 'postgres'

type JSONValue = postgres.JSONValue

declare global {
    var __postgresSqlClient: Sql | undefined
}

let sql: Sql

if (process.env.NODE_ENV === 'production') {
    sql = postgres()
} else {
    if (!global.__postgresSqlClient) {
        global.__postgresSqlClient = postgres()
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
}

export type ImageUpdate = Partial<Pick<ImageRecord, 'width' | 'height' | 'orientation' | 'description' | 'stime'>>

export interface Label {
    id: number
    name: string
}

export interface LabelCount extends Label {
    count: number
}

export interface Bundle {
    path: string
    count: string // bigint is returned as string
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
    label?: string
    status?: string
}

export interface LogUser {
    ip: string
    day: Date
    count: string // bigint is returned as string
    visitors: { name?: string | null, email?: string | null }[]
    meta: { browser?: { name?: string, major?: string, type?: string }, device?: { vendor?: string, model?: string, type?: string }, ua?: string }[]
}

export interface UserLogFilters {
    ip: string
    day?: string
    label?: string
    status?: string
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

export async function listBundles() {
    const bundles = await sql<Bundle[]>`
      SELECT
        bundle AS path,
        COUNT(id) AS count
      FROM image
      GROUP BY bundle
      ORDER BY path
    `
    return bundles
}

export async function listLabels() {
    const labels = await sql<LabelCount[]>`
      SELECT
        id,
        name,
        COUNT(image)::int AS count
      FROM label
      INNER JOIN label_image
      ON (label = id)
      GROUP BY id
      ORDER BY name ASC
    `
    return labels
}

export async function listRelatedLabels(include: number[], exclude: number[]) {
    const having: Fragment[] = []
    if (include.length > 0)
        having.push(...include.map(label => sql`SUM(CASE WHEN label=${label} THEN 1 ELSE 0 END) > 0`))
    if (exclude.length > 0)
        having.push(...exclude.map(label => sql`SUM(CASE WHEN label=${label} THEN 1 ELSE 0 END) = 0`))

    if (having.length === 0)
        return [] // never output all labels

    const selected = [...include, ...exclude]

    const labels = await sql<LabelCount[]>`
      WITH label_count AS (
        SELECT image FROM label_image
        GROUP BY image
        HAVING ${and(having)}
      )
      SELECT id, name, COUNT(image)::int AS count FROM label
      JOIN label_image ON id = label
      WHERE
        label NOT IN ${sql(selected)}
        AND
        EXISTS (
          SELECT 1 FROM label_count
          WHERE image = label_image.image
        )
      GROUP BY id
      HAVING COUNT(image) > 0
      ORDER BY count DESC, name ASC
    `
    return labels
}

export async function listImages(filters: ImageFilters, order: string) {
    const restrictedLabels = await getRestrictedLabels()

    const where = [sql`width > 0`] // list only images with width, otherwise ReactPhotoAlbum gets broken

    if (filters.bundle)
        where.push(sql`bundle = ${filters.bundle}`)

    if (filters.from)
        where.push(sql`stime >= ${filters.from}`)
    if (filters.till)
        where.push(sql`stime <= ${filters.till}`)

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

    let join = sql``
    let group = sql``
    if (labels.length > 0) {
        join = sql`INNER JOIN label_image ON (id = image)`
        group = sql`GROUP BY id`
    } else if (restrictedLabels.length > 0) {
        join = sql`LEFT JOIN label_image ON (id = image)`
        group = sql`GROUP BY id`
    }

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
      ORDER BY ${sql(order)}
    `
    return images
}

export async function getBundleImages(bundle: string) {
    const images = await sql<Pick<ImageRecord, 'id' | 'name'>[]>`
      SELECT
        id,
        name
      FROM image
      WHERE bundle = ${bundle}
    `
    return images
}

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

/**
 * Inserts a photo with its labels in one transaction. Returns its id, or `undefined` if the photo is already there
 * (another sync of the same album added it meanwhile).
 */
export async function addImage(bundle: string, name: string, data: ImageUpdate, labels: number[]) {
    return sql.begin(async sql => {
        const image = { bundle, name, ctime: new Date().toISOString(), ...data }
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
    })
}

export async function updateImage(id: number, data: ImageUpdate) {
    await sql`
      UPDATE image SET ${sql(data)}
      WHERE id = ${id}
    `
}

export async function deleteImage(id: number) {
    // Other tables are cascaded via DB constraint
    await sql`
      DELETE FROM image
      WHERE id = ${id}
    `
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
    })
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

export async function getLogUsers(filters: LogFilters) {
    const where: Fragment[] = []

    if (filters.from)
        where.push(sql`ctime >= ${filters.from}`)

    if (filters.label)
        where.push(sql`label = ${filters.label}`)

    if (filters.status)
        where.push(sql`status <= ${filters.status}`)

    // Switch to json_object('browser': meta->'browser', 'device': meta->'device') in PostgreSQL 16
    const users = await sql<LogUser[]>`
      SELECT
        ip,
        ctime::date AS day,
        COUNT(DISTINCT log.image) AS count,
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
      ${filters.label ? sql`
      INNER JOIN label_image ON (log.image = label_image.image)
      ` : sql``}
      LEFT JOIN visitor ON (log.visitor_id = visitor.id AND log.visitor_provider = visitor.provider)
      ${where.length > 0 ? sql`WHERE ${and(where)}` : sql``}
      GROUP BY ip, day
      ORDER BY day DESC
    `
    return users
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

    if (filters.status)
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
