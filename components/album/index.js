'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import Image from 'next/image'
import { sendGAEvent } from '@next/third-parties/google'

import { MasonryPhotoAlbum } from 'react-photo-album'
import Lightbox from 'yet-another-react-lightbox'
import Download from 'yet-another-react-lightbox/plugins/download'

import Fullscreen from 'yet-another-react-lightbox/plugins/fullscreen'
import Zoom from 'yet-another-react-lightbox/plugins/zoom'

import { LazyLoadImage, trackWindowScroll } from 'react-lazy-load-image-component'

import GridLoader from 'react-spinners/GridLoader'

import ImageDescription from '@/components/image/description'

import debounce from 'lodash.debounce'

import lock from '@/assets/lock-password.svg'

import 'react-photo-album/masonry.css'
import 'yet-another-react-lightbox/styles.css'
import './album.scss'
import './lightbox.scss'

import { log } from '@/lib/actions'
import { ACTION_ZOOM, ACTION_THUMBNAIL, ACTION_INFO } from '@/lib/utils'

function scrollTo(id) {
    setTimeout(() => { // for some reason album is not ready on first render
        const thumbnail = document.getElementById('thumbnail-' + id)
        if (thumbnail)
            thumbnail.scrollIntoView({ behavior: 'instant', block: 'center' })
    }, 100)
}

function Album(props) {
    const { photos, ip, user, meta, scrollPosition } = props

    const [index, setIndex] = useState(-1)

    const urlRef = useRef(undefined)
    const pathname = usePathname()
    const router = useRouter()
    const searchParams = useSearchParams()

    const setIndexFromHash = (opener) => {
        if (window.location.hash.startsWith('#view-')) {
            const hs = window.location.hash.split('-')
            setIndex(hs[1])
            scrollTo(hs[2])
        } else {
            setIndex(-1)
            if (opener !== null)
                scrollTo(opener)
        }
    }

    const handleBackEvent = useCallback((event) => {
        if (event.state)
            setIndexFromHash(null)
    }, [])

    useEffect(() => {
        window.addEventListener('popstate', handleBackEvent)
        return () => window.removeEventListener('popstate', handleBackEvent)
    }, [handleBackEvent])

    useEffect(() => {
        const url = `${pathname}?${searchParams}`
        if (urlRef.current !== url) { // effect is fired even when only hash of url is changed
            urlRef.current = url
            setIndexFromHash(searchParams.get('opener'))
        }
    }, [pathname, searchParams])

    const signIn = () => {
        const callbackUrl = window.location.href.substring(window.location.origin.length)
        router.push(`/api/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`)
    }

    const handleThumbnailClick = ({ index }) => {
        if (photos[index].restricted && user.id === undefined)
            signIn()
        else
            setIndex(index)
    }

    const handleZoom = (zoom) => {
        log(photos[index].id, ACTION_ZOOM, ip, user, { zoom, ...meta })
        sendGAEvent('event', 'zoom_photo', {
            event_category: 'galleria',
            event_label: photos[index].src,
            value: zoom
        })
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
    const handleDebouncedZoom = useCallback(debounce(handleZoom, 1000), [photos, index])

    const handleImageLoad = async (e, photo) => {
        e.target.classList.add('lazyloaded')
        log(photo.id, ACTION_THUMBNAIL, ip, user, meta)
    }

    const handleDownload = () => {
        const ids = photos.map(image => image.id)
        sendGAEvent('event', 'download_photos', {
            event_category: 'galleria',
            event_label: ids.join()
        })
        router.push(`/download?images=${ids.join()}`)
    }

    const thumbnails = photos.map(image => (
        {
            ...image,
            src: image.srcSet.at(-2).src,
            srcSet: image.srcSet.slice(0, -1)
        }
    ))

    return <>
        <MasonryPhotoAlbum
            photos={thumbnails}
            breakpoints={[451, 801, 1201, 1801]}
            columns={(containerWidth) => {
                if (containerWidth < 451) return 1
                if (containerWidth < 801) return 2
                if (containerWidth < 1201) return 3
                if (containerWidth < 1801) return 4
                return 5
            }}
            spacing={(containerWidth) => {
                if (containerWidth < 801) return 5
                if (containerWidth < 1201) return 10
                return 15
            }}
            onClick={handleThumbnailClick}
            render={{
                button: (props, { photo }) => (
                    <button
                        {...props}
                        id={`thumbnail-${photo.id}`} />
                ),
                image: (props, { photo }) => (
                    <>
                        <LazyLoadImage
                            {...props}
                            className={`${props.className}${photo.restricted && user.id === undefined ? ' restricted' : ''}`}
                            scrollPosition={scrollPosition}
                            threshold={0}
                            onLoad={(e) => handleImageLoad(e, photo)} />
                        {photo.restricted && user.id === undefined && <Image src={lock} alt="" unoptimized className="lock" />}
                    </>
                )
            }} />
        <Lightbox
            slides={photos}
            open={index >= 0}
            index={index}
            close={() => {
                setIndex(-1)
                const location = window.location.href.split('#')[0]
                window.history.replaceState({}, '', location)
            }}
            on={{
                view: async ({ index: currentIndex }) => {
                    setIndex(currentIndex)
                    const location = window.location.href.split('#')[0] + '#view-' + currentIndex + '-' + photos[currentIndex].id
                    if (window.location.hash.startsWith('#view-'))
                        window.history.replaceState({ view: photos[currentIndex].id }, '', location)
                    else
                        window.history.pushState({ view: photos[currentIndex].id }, '', location)
                    await log(photos[currentIndex].id, ACTION_INFO, ip, user, meta)
                    sendGAEvent('event', 'view_photo', {
                        event_category: 'galleria',
                        event_label: photos[currentIndex].src
                    })
                },
                zoom: async ({ zoom }) => {
                    if (zoom > 1.1)
                        handleDebouncedZoom(zoom)
                },
                download: async ({ index: currentIndex }) => {
                    sendGAEvent('event', 'download_photo', {
                        event_category: 'galleria',
                        event_label: photos[currentIndex].src
                    })
                }
            }}
            carousel={{
                preload: 0
            }}
            plugins={[Download, Fullscreen, Zoom]}
            render={{
                buttonPrev: photos.length <= 1 ? () => null : undefined,
                buttonNext: photos.length <= 1 ? () => null : undefined,
                iconLoading: () => <GridLoader color="white" />,
                slideContainer: ({ slide, children }) => (
                    <div className={`slide_container${slide.restricted && user.id === undefined ? ' restricted' : ''}`}>
                        {children}
                        {slide.restricted && user.id === undefined && <Image src={lock} onClick={signIn} alt="" unoptimized className="lock" />}
                    </div>
                ),
                slideFooter: ({ slide }) => <ImageDescription id={slide.id} className="image_description" />
            }}
            download={{
                download: ({ slide, saveAs }) => { // this is required for disableable downloads
                    saveAs(slide.download)
                }
            }}
        />
        {user?.id && (
            <div className="download">
                <button className="button" onClick={handleDownload}>Скачать все фотографии</button>
            </div>
        )}
        <svg className="hiddenSvg">
            <filter id="sharpBlur">
                <feGaussianBlur stdDeviation="8"></feGaussianBlur>
                <feColorMatrix type="matrix" values="1 0 0 0 0, 0 1 0 0 0, 0 0 1 0 0, 0 0 0 9 0"></feColorMatrix>
                <feComposite in2="SourceGraphic" operator="in"></feComposite>
            </filter>
        </svg>
    </>
}

export default trackWindowScroll(Album)
