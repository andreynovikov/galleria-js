import postgres from 'postgres'

const sql = postgres()

export async function listImages(filters, order) {
    // List only images with width, otherwise ReactPhotoAlbum gets broken
    const images = await sql`
      SELECT
        id,
        name,
        bundle,
        description,
        width,
        height
      FROM image
      WHERE bundle = ${filters.bundle} AND width > 0
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
