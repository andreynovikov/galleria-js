import postgres from 'postgres'

const sql = postgres()

// helpers (https://github.com/porsager/postgres/discussions/529)
const and = arr => arr.reduce((acc, x) => sql`${acc} AND ${x}`)
const or = arr => arr.reduce((acc, x) => sql`(${acc} OR ${x})`)

export async function listImages(filters, order) {
    const where = [sql`width > 0`] // list only images with width, otherwise ReactPhotoAlbum gets broken

    if (filters.bundle)
        where.push(sql`bundle = ${filters.bundle}`)

    if (filters.from)
        where.push(sql`stime >= ${filters.from}`)
    if (filters.till)
        where.push(sql`stime <= ${filters.till}`)


    const labels = []
    if (filters.labels?.length > 0)
        labels.push(...filters.labels.map(label => sql`SUM(CASE WHEN label=${label} THEN 1 ELSE 0 END) > 0`))
    if (filters.notlabels?.length > 0)
        labels.push(...filters.notlabels.map(label => sql`SUM(CASE WHEN label=${label} THEN 1 ELSE 0 END) = 0`))

    if (labels.length > 0)
        where.push(sql`label_image.label IS NOT NULL`)

    if (where.length === 1)
        return [] // never output all images

    const images = await sql`
      SELECT
        id,
        name,
        bundle,
        description,
        width,
        height
      FROM image
      ${labels.length > 0 ? sql`
      INNER JOIN label_image ON (id = image)
      ` : sql``}
      WHERE ${and(where)}
      ${labels.length > 0 ? sql`
      GROUP BY id
      HAVING ${and(labels)}
      ` : sql``}
      ORDER BY ${sql(order)}
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
