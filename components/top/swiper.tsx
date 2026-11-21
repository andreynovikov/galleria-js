'use client'

import type { SyntheticEvent } from 'react'
import Link from 'next/link'
import Image from 'next/image'

import { Swiper, SwiperSlide } from 'swiper/react'
import { FreeMode } from 'swiper/modules'

import 'swiper/css'
import 'swiper/css/free-mode'

import styles from './swiper.module.css'


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
}

export default function PhotoSwiper({ photos }: PhotoSwiperProps) {
    // Thumbnail views are logged by the image route
    const handleImageLoad = (event: SyntheticEvent<HTMLImageElement>) => {
        event.currentTarget.classList.add(styles.lazyloaded)
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
                                onLoad={handleImageLoad} />
                        </Link>
                    </SwiperSlide>
                ))}
            </Swiper>
        </>
    )
}
