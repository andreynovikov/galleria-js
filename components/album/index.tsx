'use client'

import { useState, useEffect, useCallback, useMemo, useRef, type SyntheticEvent } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { sendGAEvent } from '@next/third-parties/google'

import { MasonryPhotoAlbum, type Photo } from 'react-photo-album'
import Lightbox, { type Slide } from 'yet-another-react-lightbox'
import Download from 'yet-another-react-lightbox/plugins/download'

import Fullscreen from 'yet-another-react-lightbox/plugins/fullscreen'
import Zoom from 'yet-another-react-lightbox/plugins/zoom'

import { LazyLoadImage, trackWindowScroll, type LazyComponentProps } from 'react-lazy-load-image-component'

import GridLoader from 'react-spinners/GridLoader'

import ImageDescription from '@/components/image/description'

import debounce from 'lodash.debounce'

import 'react-photo-album/masonry.css'
import 'yet-another-react-lightbox/styles.css'
import './album.css'
import './lightbox.css'

import { log } from '@/lib/actions'
import type { LogMeta, VisitorRef } from '@/lib/db'
import { ACTION_ZOOM, ACTION_THUMBNAIL, ACTION_LOCKED, ACTION_INFO } from '@/lib/utils'

export interface ImageSource {
    src: string
    width: number
    height: number
}

export interface AlbumPhoto {
    id: number
    src: string
    /** URL of the original image or `false` if download is not allowed */
    download: string | false
    title: string
    width: number
    height: number
    restricted: boolean
    /** Thumbnails followed by screen-size image */
    srcSet: ImageSource[]
}

type Thumbnail = Photo & AlbumPhoto

interface AlbumProps extends LazyComponentProps {
    photos: AlbumPhoto[]
    ip: string
    user?: VisitorRef
    meta: LogMeta
    basePath: string
}

function scrollTo(id: string | null) {
    setTimeout(() => { // for some reason album is not ready on first render
        const thumbnail = document.getElementById('thumbnail-' + id)
        if (thumbnail)
            thumbnail.scrollIntoView({ behavior: 'instant', block: 'center' })
    }, 100)
}

function Album(props: AlbumProps) {
    const { photos, ip, user, meta, basePath, scrollPosition } = props

    const [index, setIndex] = useState(-1)

    const urlRef = useRef<string>(undefined)
    const pathname = usePathname()
    const router = useRouter()
    const searchParams = useSearchParams()

    const setIndexFromHash = (opener: string | null) => {
        if (window.location.hash.startsWith('#view-')) {
            const hs = window.location.hash.split('-')
            setIndex(Number(hs[1]))
            scrollTo(hs[2])
        } else {
            setIndex(-1)
            if (opener !== null)
                scrollTo(opener)
        }
    }

    const handleBackEvent = useCallback((event: PopStateEvent) => {
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
        router.push(`/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`)
    }

    const handleThumbnailClick = ({ index }: { index: number }) => {
        if (photos[index].restricted && user?.id === undefined)
            signIn()
        else
            setIndex(index)
    }

    const handleZoom = (zoom: number) => {
        log(photos[index].id, ACTION_ZOOM, ip, user, { zoom, ...meta })
        sendGAEvent('event', 'zoom_photo', {
            event_category: 'galleria',
            event_label: photos[index].src,
            value: zoom
        })
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
    const handleDebouncedZoom = useMemo(() => debounce(handleZoom, 1000), [photos, index])

    const handleImageLoad = async (event: SyntheticEvent<HTMLImageElement>, photo: Thumbnail) => {
        event.currentTarget.classList.add('lazyloaded')
        log(photo.id, photo.restricted ? ACTION_LOCKED : ACTION_THUMBNAIL, ip, user, meta)
    }

    const handleDownload = () => {
        const ids = photos.map(image => image.id)
        sendGAEvent('event', 'download_photos', {
            event_category: 'galleria',
            event_label: ids.join()
        })
        // Route handlers are opened with plain browser navigation instead of router.push(): the router would
        // fetch the archive once more and record it as the current URL, where server actions would be posted
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- route handler, not a page
        window.location.assign(`${basePath}/download?images=${ids.join()}`)
    }

    const thumbnails: Thumbnail[] = photos.map(image => (
        {
            ...image,
            src: image.srcSet.at(-2)?.src ?? image.src,
            srcSet: image.srcSet.slice(0, -1)
        }
    ))

    const slides: Slide[] = photos

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
                    <LazyLoadImage
                        {...props}
                        className={props.className}
                        scrollPosition={scrollPosition}
                        threshold={0}
                        onLoad={(e) => handleImageLoad(e, photo)} />
                )
            }} />
        <Lightbox
            slides={slides}
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
                slideFooter: ({ slide }) => <ImageDescription id={(slide as AlbumPhoto).id} className="image_description" />
            }}
            download={{
                download: ({ slide, saveAs }) => { // this is required for disableable downloads
                    const url = (slide as AlbumPhoto).download
                    if (url)
                        saveAs(url)
                }
            }}
        />
        {user?.id && (
            <div className="download">
                <button className="button" onClick={handleDownload}>Скачать все фотографии</button>
            </div>
        )}
    </>
}

export default trackWindowScroll(Album)
