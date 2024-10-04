'use client'

import { useState } from 'react'

import { MasonryPhotoAlbum } from 'react-photo-album'
import Lightbox from 'yet-another-react-lightbox'
import Download from 'yet-another-react-lightbox/plugins/download'

import Fullscreen from 'yet-another-react-lightbox/plugins/fullscreen'
import Zoom from 'yet-another-react-lightbox/plugins/zoom'

import 'yet-another-react-lightbox/styles.css'
import 'react-photo-album/masonry.css'

export default function Album(props) {
    const { photos } = props

    const [index, setIndex] = useState(-1)

    return <>
        <MasonryPhotoAlbum
            photos={photos}
            breakpoints={[400, 800, 1200]}
            columns={(containerWidth) => {
                if (containerWidth < 400) return 1
                if (containerWidth < 800) return 2
                if (containerWidth < 1200) return 3
                return 4
            }}
            spacing={(containerWidth) => {
                if (containerWidth < 400) return 5
                if (containerWidth < 800) return 5
                if (containerWidth < 1200) return 10
                return 15
            }}
            onClick={({ index }) => setIndex(index)} />
        <Lightbox
            slides={photos}
            open={index >= 0}
            index={index}
            close={() => setIndex(-1)}
            carousel={{
                preload: 0
            }}
            plugins={[Download, Fullscreen, Zoom]}
        />
    </>
}