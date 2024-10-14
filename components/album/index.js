'use client'

import { useState, useEffect } from 'react'

import { MasonryPhotoAlbum } from 'react-photo-album'
import Lightbox from 'yet-another-react-lightbox'
import Download from 'yet-another-react-lightbox/plugins/download'

import Fullscreen from 'yet-another-react-lightbox/plugins/fullscreen'
import Zoom from 'yet-another-react-lightbox/plugins/zoom'

import ImageDescription from '@/components/image/desctiption'

import 'react-photo-album/masonry.css'
import 'yet-another-react-lightbox/styles.css'
import './lightbox.css'

export default function Album(props) {
    const { photos } = props

    const [index, setIndex] = useState(-1)

    const handleBackEvent = (event) => {
        if (event.state)
            setIndex(-1)
    }

    useEffect(() => {
        if (window.location.hash.startsWith('#view-')) {
            const hs = window.location.hash.split('-')
            setIndex(hs[1])
            const scrollTo = hs[2]
            setTimeout(() => { // for some reason album is not ready on first render
                const thumbnail = document.getElementById('thumbnail-' + scrollTo)
                if (thumbnail)
                    thumbnail.scrollIntoView({behavior: 'instant', block: 'center'})
            }, 100)
        }
        window.addEventListener('popstate', handleBackEvent)
        return () => window.removeEventListener('popstate', handleBackEvent)
    }, [])

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
                image: (props, { photo }) => <img {...props} id={`thumbnail-${photo.id}`} />
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
                view: ({ index: currentIndex }) => {
                    setIndex(currentIndex)
                    const location = window.location.href.split('#')[0] + '#view-' + currentIndex + '-' + photos[currentIndex].id
                    if (window.location.hash.startsWith('#view-'))
                        window.history.replaceState({ view: photos[currentIndex].id }, '', location)
                    else
                        window.history.pushState({ view: photos[currentIndex].id }, '', location)
                }
            }}
            carousel={{
                preload: 0
            }}
            plugins={[Download, Fullscreen, Zoom]}
            render={{
                buttonPrev: photos.length <= 1 ? () => null : undefined,
                buttonNext: photos.length <= 1 ? () => null : undefined,
                slideFooter: ({slide}) => <ImageDescription id={slide.id} className="image_description" />
            }}
        />
    </>
}