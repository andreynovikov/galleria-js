import { unstable_cache } from 'next/cache'

import postgres from 'postgres'

let sql

if (process.env.NODE_ENV === 'production') {
    sql = postgres()
} else {
    if (!global.__postgresSqlClient) {
        global.__postgresSqlClient = postgres()
    }
    sql = global.__postgresSqlClient
}

const adminIds = process.env.ADMIN_ID?.split(',') ?? []

async function getUncachedLabelMaps() {
    console.log('getUncachedLabelMaps')
    const labels = await listLabels()
    const labelIds = {}
    labels.forEach(item => labelIds[item.name] = item.id)
    return labelIds
}

async function getUncachedRestictedLabels() {
  console.log('getUncachedRestictedLabels')
  let labels = process.env.RESTRICTED_LABELS
  if (labels !== undefined) {
      const labelIds = await getUncachedLabelMaps()
      labels = labels.split(',').map(l => {
          if (isNaN(l))
              l = labelIds[l] ?? 0
          return +l 
      }).filter(l => l > 0)
      return labels.filter((e, i, a) => a.indexOf(e) == i)
  }
  return []
}

export const getLabelMaps = unstable_cache(getUncachedLabelMaps)
export const getRestrictedLabels = unstable_cache(getUncachedRestictedLabels)

// helpers (https://github.com/porsager/postgres/discussions/529)
const and = arr => arr.reduce((acc, x) => sql`${acc} AND ${x}`)
const or = arr => arr.reduce((acc, x) => sql`(${acc} OR ${x})`)

export async function listBundles() {
    const bundles = await sql`
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
    const labels = await sql`
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

export async function listRelatedLabels(include, exclude) {
    const having = []
    if (include.length > 0)
        having.push(...include.map(label => sql`SUM(CASE WHEN label=${label} THEN 1 ELSE 0 END) > 0`))
    if (exclude.length > 0)
        having.push(...exclude.map(label => sql`SUM(CASE WHEN label=${label} THEN 1 ELSE 0 END) = 0`))

    if (having.length === 0)
        return [] // never output all labels

    const selected = [].concat(include, exclude)

    const labels = await sql`
      WITH label_count AS (
        SELECT image FROM label_image
        GROUP BY image
        HAVING ${and(having)}
      )
      SELECT id, name, COUNT(image) AS count FROM label
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

export async function listImages(filters, order) {
    const restrictedLabels = await getRestrictedLabels()

    const where = [sql`width > 0`] // list only images with width, otherwise ReactPhotoAlbum gets broken

    if (filters.bundle)
        where.push(sql`bundle = ${filters.bundle}`)

    if (filters.from)
        where.push(sql`stime >= ${filters.from}`)
    if (filters.till)
        where.push(sql`stime <= ${filters.till}`)

    if (filters.top)
        where.push(sql`bundle != '/motos/voge500'`)

    const labels = []
    if (filters.labels?.length > 0)
        labels.push(...filters.labels.map(label => sql`SUM(CASE WHEN label=${label} THEN 1 ELSE 0 END) > 0`))
    if (filters.notlabels?.length > 0)
        labels.push(...filters.notlabels.map(label => sql`SUM(CASE WHEN label=${label} THEN 1 ELSE 0 END) = 0`))

    if (labels.length > 0)
        where.push(sql`label_image.label IS NOT NULL`)

    if (where.length === 1)
        return [] // never output all images

    if (filters.censored) // auxilary filter
        where.push(sql`censored <= ${filters.censored}`)
    else
        where.push(sql`censored = 0`)

    let join = sql``
    let group = sql``
    if (filters.top) {
        join = sql`INNER JOIN log ON (id = log.image) LEFT JOIN label_image ON (id = label_image.image)`
        group = sql`GROUP BY id`
        order = 'count'
    } else if (labels.length > 0) {
        join = sql`INNER JOIN label_image ON (id = image)`
        group = sql`GROUP BY id`
    } else if (restrictedLabels.length > 0) {
        join = sql`LEFT JOIN label_image ON (id = image)`
        group = sql`GROUP BY id`
    }

    const images = await sql`
      SELECT
        id,
        name,
        bundle,
        description,
        width,
        height
      ${restrictedLabels.length > 0 ? sql`,
        array_agg(label_image.label) && ${restrictedLabels} AS restricted
      ` : sql``}
      ${filters.top ? sql`,
        COUNT(log.image) AS count
      ` : sql``}
      FROM image
      ${join}
      WHERE ${and(where)}
      ${group}
      ${labels.length > 0 ? sql`
      HAVING ${and(labels)}
      ` : sql``}
      ORDER BY ${sql(order)}
      ${filters.top ? sql`
      DESC LIMIT 30
      ` : sql``}
    `
    return images
}

export async function getBundleImages(bundle) {
    const images = await sql`
      SELECT
        id,
        name
      FROM image
      WHERE bundle = ${bundle}
    `
    return images
}

export async function getImageById(id) {
    const result = await sql`
      SELECT * FROM image
      WHERE id = ${id}
    `
    return result[0]
}

export async function getImageByName(bundle, name) {
    const result = await sql`
      SELECT * FROM image
      WHERE bundle = ${bundle} AND name = ${name}
    `
    return result[0]
}

export async function addImage(bundle, name) {
    const ctime = new Date()
    const image = { bundle, name, ctime: ctime.toISOString() }
    const result = await sql`
      INSERT INTO image ${sql(image)}
      RETURNING id
    `
    return { id: result[0].id, ctime }
}

export async function updateImage(id, data) {
    await sql`
      UPDATE image SET ${sql(data)}
      WHERE id = ${id}
    `
}

export async function deleteImage(id) {
    // Other tables are cascaded via DB constraint 
    await sql`
      DELETE FROM image
      WHERE id = ${id}
    `
}

export async function getImageLabels(id) {
    const labels = await sql`
      SELECT id, name FROM label
      INNER JOIN label_image ON (id = label AND image = ${id})
    `
    return labels
}

export async function setImageLabels(id, labels) {
    const current = (await sql`
      SELECT label FROM label_image
      WHERE image = ${id}
    `.values()).map(r => r[0])
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
            await sql`
              SELECT
                id,
                COUNT(image)
              FROM label
              LEFT JOIN label_image ON (id = label)
              WHERE id IN ${sql(toBeDeleted)}
              GROUP BY id
              HAVING COUNT(image) = 0
            `.forEach(async (row) => {
                await sql`
                  DELETE FROM label
                  WHERE id = ${row.id}
                `
            })
        }
    })
}

export async function getLabelIds(labels) {
    const ids = []
    for (const label of labels) {
        let result = await sql`
          SELECT
            id
          FROM label
          WHERE name = ${label}
        `
        if (result.length == 0) {
            result = await sql`
              INSERT INTO label (name)
              VALUES (${label})
              RETURNING id
            `
        }
        ids.push(result[0].id)
    }
    return ids
}

export async function getUser(id, provider, userData) {
    const data = { ...userData }
    delete data['id'] // drop dynamic user id
    const result = await sql`
      INSERT INTO visitor ${sql({id, provider, data})}
      ON CONFLICT (id, provider) DO UPDATE SET
      (data) = ROW(EXCLUDED.data)
      RETURNING *
    `

    const user = {
        ...result[0].data,
        ...result[0]
    }
    delete user['data']
    return user
}

export async function writeLog(image, status, ip, visitor, meta=null) {
    if (visitor?.id !== undefined && adminIds.includes(visitor.id))
        return
    const entry = {
        image,
        status,
        ip,
        visitor_id: visitor?.id ?? null,
        visitor_provider: visitor?.provider ?? null,
        ctime: new Date(),
        meta
    }
    await sql`INSERT INTO log ${sql(entry)}`
}

export async function getLogUsers(filters) {
    const where = []

    if (filters.from)
        where.push(sql`ctime >= ${filters.from}`)

    if (filters.label)
        where.push(sql`label = ${filters.label}`)

    if (filters.status)
        where.push(sql`status <= ${filters.status}`)
    
    // Switch to json_object('browser': meta->'browser', 'device': meta->'device') in PostgreSQL 16
    const users = await sql`
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
      WHERE ${and(where)}
      GROUP BY ip, day
      ORDER BY day DESC
    `
    return users
}

export async function getUserLog(filters) {
  const where = [sql`ip = ${filters.ip}`]
  const group = ['image.id', 'visitor_id', 'visitor_provider']
  let day = sql``

  if (filters.day) {
      where.push(sql`date(log.ctime) = ${filters.day}`)
  } else {
      day = sql`, log.ctime::date AS day`
      group.push('day')
  }

  if (filters.label)
      where.push(sql`label = ${filters.label}`)

  if (filters.status)
      where.push(sql`status <= ${filters.status}`)

  const images = await sql`
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
