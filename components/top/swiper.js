"use client"

import Link from 'next/link'
import Image from 'next/image'

import { Swiper, SwiperSlide } from 'swiper/react'
import { FreeMode } from 'swiper/modules'

import 'swiper/css'
import 'swiper/css/free-mode'

import styles from './swiper.module.scss'

import { log } from '@/lib/actions'
import { ACTION_THUMBNAIL, ACTION_LOCKED } from '@/lib/utils'

export default function PhotoSwiper(props) {
    const { photos, ip, user, meta } = props

    const handleImageLoad = async (event, photo) => {
        event.target.classList.add(styles.lazyloaded)
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
                            <Image
                                src={photo.src}
                                srcSet={photo.srcSet}
                                width={photo.width}
                                height={photo.height}
                                sizes="(width <= 600px) 10vw, 25vw"
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
