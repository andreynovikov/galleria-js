'use client'

import { useState, useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

import { MasonryPhotoAlbum } from 'react-photo-album'
import Lightbox from 'yet-another-react-lightbox'
import Download from 'yet-another-react-lightbox/plugins/download'

import Fullscreen from 'yet-another-react-lightbox/plugins/fullscreen'
import Zoom from 'yet-another-react-lightbox/plugins/zoom'

import { LazyLoadImage, trackWindowScroll } from 'react-lazy-load-image-component'

import GridLoader from 'react-spinners/GridLoader'

import ImageDescription from '@/components/image/description'

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
    const { photos, user, scrollPosition } = props

    const [index, setIndex] = useState(-1)

    const urlRef = useRef()
    const pathname = usePathname()
    const searchParams = useSearchParams()

    useEffect(() => {
        if (window.location.hash.startsWith('#view-')) {
            const hs = window.location.hash.split('-')
            setIndex(hs[1])
            scrollTo(hs[2])
        }

        window.addEventListener('popstate', handleBackEvent)
        return () => window.removeEventListener('popstate', handleBackEvent)
    }, [])

    useEffect(() => {
        const url = `${pathname}?${searchParams}`
        if (urlRef.current !== url) { // effect is fired even when url only hash of url is changed
            setIndex(-1)
            urlRef.current = url
            const id = searchParams.get('opener')
            if (id !== undefined)
                scrollTo(id)
        }
    }, [pathname, searchParams])

    const handleBackEvent = (event) => {
        if (event.state)
            setIndex(-1)
    }

    const handleImageLoad = async (e, photo) => {
        e.target.classList.add('lazyloaded')
        log(photo.id, ACTION_THUMBNAIL, user)
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
            onClick={({ index }) => setIndex(index)}
            render={{
                button: (props, { photo }) => (
                    <button
                        {...props}
                        id={`thumbnail-${photo.id}`} />
                ),
                image: (props, { photo }) => (
                    <LazyLoadImage
                        {...props}
                        scrollPosition={scrollPosition}
                        threshold={0}
                        onLoad={(e) => handleImageLoad(e, photo)} />
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
                    await log(photos[currentIndex].id, ACTION_INFO, user)
                },
                zoom: async ({ zoom }) => {
                    console.log('zoom')
                    log(photos[index].id, ACTION_ZOOM, user)
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
                slideFooter: ({ slide }) => <ImageDescription id={slide.id} className="image_description" />
            }}
        />
    </>
}

export default trackWindowScroll(Album)
