'use client'

import type { SyntheticEvent } from 'react'
import Link from 'next/link'
import Image from 'next/image'

import { Swiper, SwiperSlide } from 'swiper/react'
import { FreeMode } from 'swiper/modules'

import 'swiper/css'
import 'swiper/css/free-mode'

import styles from './swiper.module.scss'

import { log } from '@/lib/actions'
import type { LogMeta, VisitorRef } from '@/lib/db'
import { ACTION_THUMBNAIL, ACTION_LOCKED } from '@/lib/utils'

export interface SwiperPhoto {
    id: number
    src: string
    href: string
    title: string
    width: number
    height: number
    restricted: boolean
}

interface PhotoSwiperProps {
    photos: SwiperPhoto[]
    ip: string
    user?: VisitorRef
    meta: LogMeta
}

export default function PhotoSwiper({ photos, ip, user, meta }: PhotoSwiperProps) {
    const handleImageLoad = async (event: SyntheticEvent<HTMLImageElement>, photo: SwiperPhoto) => {
        event.currentTarget.classList.add(styles.lazyloaded)
        log(photo.id, photo.restricted ? ACTION_LOCKED : ACTION_THUMBNAIL, ip, user, meta)
    }

    return (
        <>
            <Swiper
                slidesPerView={'auto'}
                spaceBetween={0}
                freeMode={true}
                modules={[FreeMode]}
                className={styles.swiper}
            >
                {photos.map(photo => (
                    <SwiperSlide key={photo.id} className={styles.slide}>
                        <Link href={photo.href}>
                            {/* Thumbnails are already resized and access-controlled by the image route */}
                            <Image
                                src={photo.src}
                                width={photo.width}
                                height={photo.height}
                                unoptimized
                                alt={photo.title}
                                className={styles.image}
                                onLoad={(e) => handleImageLoad(e, photo)} />
                        </Link>
                    </SwiperSlide>
                ))}
            </Swiper>
        </>
    )
}
