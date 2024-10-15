'use client'

import { useState, useEffect } from 'react'

import { MasonryPhotoAlbum } from 'react-photo-album'
import Lightbox from 'yet-another-react-lightbox'
import Download from 'yet-another-react-lightbox/plugins/download'

import Fullscreen from 'yet-another-react-lightbox/plugins/fullscreen'
import Zoom from 'yet-another-react-lightbox/plugins/zoom'

import { LazyLoadImage, trackWindowScroll } from 'react-lazy-load-image-component'

import GridLoader from 'react-spinners/GridLoader'

import ImageDescription from '@/components/image/desctiption'

import 'react-photo-album/masonry.css'
import 'yet-another-react-lightbox/styles.css'
import './album.scss'
import './lightbox.scss'

import { log } from '@/lib/actions'
import { ACTION_THUMBNAIL, ACTION_INFO } from '@/lib/utils'

function Album(props) {
    const { photos, user, scrollPosition } = props

    const [index, setIndex] = useState(-1)

    useEffect(() => {
        if (window.location.hash.startsWith('#view-')) {
            const hs = window.location.hash.split('-')
            setIndex(hs[1])
            const scrollTo = hs[2]
            setTimeout(() => { // for some reason album is not ready on first render
                const thumbnail = document.getElementById('thumbnail-' + scrollTo)
                if (thumbnail)
                    thumbnail.scrollIntoView({ behavior: 'instant', block: 'center' })
            }, 100)
        }
        window.addEventListener('popstate', handleBackEvent)
        return () => window.removeEventListener('popstate', handleBackEvent)
    }, [])

    const handleBackEvent = (event) => {
        if (event.state)
            setIndex(-1)
    }

    const handleImageLoad = async (e, photo) => {
        await log(photo.id, ACTION_THUMBNAIL, user)
        e.target.classList.add('lazyloaded')
        console.log(photo)
    }

    return <>
        <MasonryPhotoAlbum
            photos={photos}
            breakpoints={[400, 800, 1200]}
            columns={(containerWidth) => {
                if (containerWidth < 400) return 1
                if (containerWidth < 800) return 2
                if (containerWidth < 1200) return 3
                return 5
            }}
            spacing={(containerWidth) => {
                if (containerWidth < 400) return 5
                if (containerWidth < 800) return 5
                if (containerWidth < 1200) return 10
                return 15
            }}
            onClick={({ index }) => setIndex(index)}
            render={{
                image: (props, { photo }) => (
                    <LazyLoadImage
                        {...props}
                        id={`thumbnail-${photo.id}`}
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
