import { getUserLog } from '@/lib/db'
import { auth } from '@/auth'

const basePath = process.env.BASE_PATH ?? ''

export default async function History({ params }) {
    const session = await auth()
    if (!session.user)
        redirect('/api/auth/signin')

    const filters = {
        user: decodeURIComponent(params.user),
        day: decodeURIComponent(params.day)
    }
    const images = await getUserLog(filters)

    return (
        <>
            <h1>
                {filters.user}
            </h1>
            <div className="images">
                {images.map(image => (
                    <a href={`${basePath}${image.bundle}/${image.name}`} key={image.id}>
                        <img
                            loading="lazy"
                            decoding="async"
                            src={`${basePath}${image.bundle}/${image.name}?format=thumbnail&size=s`}
                            className={`status${image.status}`}
                            style={{ aspectRatio: image.width / image.height }} />
                    </a>

                ))}
            </div>
        </>
    )
}
