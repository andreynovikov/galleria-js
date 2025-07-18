"use client"

import Link from 'next/link'
import Image from 'next/image'

import { Swiper, SwiperSlide } from 'swiper/react'
import { FreeMode } from 'swiper/modules'

import lock from '@/assets/lock-password.svg'

import 'swiper/css'
import 'swiper/css/free-mode'

import styles from './swiper.module.scss'

import { log } from '@/lib/actions'
import { ACTION_THUMBNAIL } from '@/lib/utils'

export default function PhotoSwiper(props) {
    const { photos, ip, user, meta } = props

    const handleImageLoad = async (event, photo) => {
        event.target.classList.add(styles.lazyloaded)
        log(photo.id, ACTION_THUMBNAIL, ip, user, meta)
    }

    const handleContextMenu = (event) => {
        event.preventDefault()
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
                                className={`${styles.image}${photo.restricted && user?.id === undefined ? ' ' + styles.restricted : ''}`}
                                onContextMenu={handleContextMenu}
                                onLoad={(e) => handleImageLoad(e, photo)} />
                            {photo.restricted && user?.id === undefined && (
                                <Image src={lock} alt="" unoptimized onContextMenu={handleContextMenu} className={styles.lock} />
                            )}
                        </Link>
                    </SwiperSlide>
                ))}
            </Swiper>
            <svg className="hiddenSvg">
                <filter id="sharpBlur">
                    <feGaussianBlur stdDeviation="1"></feGaussianBlur>
                    <feColorMatrix type="matrix" values="1 0 0 0 0, 0 1 0 0 0, 0 0 1 0 0, 0 0 0 9 0"></feColorMatrix>
                    <feComposite in2="SourceGraphic" operator="in"></feComposite>
                </filter>
            </svg>
        </>
    )
}