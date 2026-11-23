'use client'

import { useState, useEffect, useCallback, useMemo, useRef, type SyntheticEvent } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useMessages, useTranslations } from 'next-intl'
import { sendGAEvent } from '@next/third-parties/google'

import { MasonryPhotoAlbum, type Photo } from 'react-photo-album'
import Lightbox, { type Slide } from 'yet-another-react-lightbox'
import Download from 'yet-another-react-lightbox/plugins/download'

import Fullscreen from 'yet-another-react-lightbox/plugins/fullscreen'
import Zoom from 'yet-another-react-lightbox/plugins/zoom'

import GridLoader from 'react-spinners/GridLoader'

import ImageDescription from '@/components/image/description'

import debounce from 'lodash.debounce'

import 'react-photo-album/masonry.css'
import 'yet-another-react-lightbox/styles.css'
import './album.css'
import './lightbox.css'

import { logView, logZoom } from '@/lib/actions'

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

interface AlbumProps {
    photos: AlbumPhoto[]
    signedIn: boolean
    /** Whether to show the button which downloads all photos */
    downloadable: boolean
    basePath: string
}

// Thumbnails fade in once loaded. They are loaded lazily by the browser (react-photo-album renders them with
// loading="lazy"). Thumbnail views are logged by the image route.
function handleImageLoad(event: SyntheticEvent<HTMLImageElement>) {
    event.currentTarget.classList.add('lazyloaded')
}

function scrollTo(id: string | null) {
    setTimeout(() => { // for some reason album is not ready on first render
        const thumbnail = document.getElementById('thumbnail-' + id)
        if (thumbnail)
            thumbnail.scrollIntoView({ behavior: 'instant', block: 'center' })
    }, 100)
}

export default function Album(props: AlbumProps) {
    const { photos, signedIn, downloadable, basePath } = props

    const [index, setIndex] = useState(-1)
    const t = useTranslations('Album')
    const messages = useMessages()

    const urlRef = useRef<string>(undefined)
    const pathname = usePathname()
    const router = useRouter()
    const searchParams = useSearchParams()

    // #view-<index>-<photo id> restores the slide and grid position; opener links scroll without opening a slide.
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

    const handleThumbnailClick = useCallback(({ index }: { index: number }) => {
        if (photos[index].restricted && !signedIn) {
            const callbackUrl = window.location.href.substring(window.location.origin.length)
            router.push(`/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`)
        } else {
            setIndex(index)
        }
    }, [photos, signedIn, router])

    const handleZoom = (zoom: number) => {
        logZoom(photos[index].id, zoom)
        sendGAEvent('event', 'zoom_photo', {
            event_category: 'galleria',
            event_label: photos[index].src,
            value: zoom
        })
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
    const handleDebouncedZoom = useMemo(() => debounce(handleZoom, 1000), [photos, index])

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

    // Reserve the final, screen-size source for the lightbox; the grid should request only cached thumbnails.
    const thumbnails: Thumbnail[] = useMemo(() => photos.map(image => (
        {
            ...image,
            src: image.srcSet.at(-2)?.src ?? image.src,
            srcSet: image.srcSet.slice(0, -1)
        }
    )), [photos])

    const slides: Slide[] = photos

    // The grid is laid out for all photos (hundreds in large albums), so it is kept as the same element while only
    // the lightbox changes (opening it and moving between slides update `index`)
    const grid = useMemo(() => (
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
            componentsProps={{
                image: { onLoad: handleImageLoad }
            }}
            render={{
                button: (props, { photo }) => (
                    <button
                        {...props}
                        id={`thumbnail-${photo.id}`} />
                )
            }} />
    ), [thumbnails, handleThumbnailClick])

    return <>
        {grid}
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
                    // Opening adds one history entry; changing slides replaces it so Back closes the lightbox.
                    if (window.location.hash.startsWith('#view-'))
                        window.history.replaceState({ view: photos[currentIndex].id }, '', location)
                    else
                        window.history.pushState({ view: photos[currentIndex].id }, '', location)
                    await logView(photos[currentIndex].id)
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
            // Keyed by the lightbox's own English texts, and not formatted: it fills in `{index} of {total}` itself
            labels={messages.Lightbox}
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
        {downloadable && (
            <div className="download">
                <button className="button" onClick={handleDownload}>{t('downloadAll')}</button>
            </div>
        )}
    </>
}

