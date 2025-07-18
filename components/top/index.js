import Link from 'next/link'
import Image from 'next/image'

import lock from '@/assets/lock-password.svg'

import { getRandomImages } from '@/lib/db'
import { thumbnailWidths } from '@/lib/image'

import { auth } from '@/auth'

const basePath = process.env.BASE_PATH ?? ''

import styles from './top.module.scss'

export default async function Top() {
    const session = await auth()

    const images = await getRandomImages(15)

    const photos = images.map(image => (
        {
            id: image.id,
            src: `${basePath}${image.bundle}/${image.name}`,
            href: `${image.bundle}?opener=${image.id}`,
            title: image.name,
            width: image.width,
            height: image.height,
            restricted: image.restricted ?? false,
            srcSet: Object.entries(thumbnailWidths).map(([size, width]) => ({
                src: `${basePath}${image.bundle}/${image.name}?format=thumbnail&size=${size}`,
                width,
                height: Math.round((image.height / image.width) * width)
            })).concat([{
                src: `${basePath}${image.bundle}/${image.name}`,
                width: Number(process.env.SCREEN_MAX_WIDTH),
                height: Math.round((image.height / image.width) * Number(process.env.SCREEN_MAX_WIDTH))
            }])
        }
    ))

    return (
        <>
            <div className={styles.top}>
                {photos.map(photo => (
                    <Link className={styles.photo} href={photo.href} key={photo.id}>
                        <Image
                            src={photo.src}
                            srcSet={photo.srcSet}
                            width={photo.width}
                            height={photo.height}
                            sizes="(width <= 600px) 10vw, 25vw"
                            alt={photo.title}
                            className={`${styles.image}${photo.restricted && session?.user?.id === undefined ? ' ' + styles.restricted : ''}`} />
                        {photo.restricted && session?.user?.id === undefined && (
                            <Image src={lock} alt="" unoptimized className={styles.lock} />
                        )}
                    </Link>
                ))}
            </div>
            <svg className={styles.hiddenSvg}>
                <filter id="sharpBlur">
                    <feGaussianBlur stdDeviation="1"></feGaussianBlur>
                    <feColorMatrix type="matrix" values="1 0 0 0 0, 0 1 0 0 0, 0 0 1 0 0, 0 0 0 9 0"></feColorMatrix>
                    <feComposite in2="SourceGraphic" operator="in"></feComposite>
                </filter>
            </svg>
        </>
    )
}
