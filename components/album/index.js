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
        <MasonryPhotoAlbum photos={photos} onClick={({ index }) => setIndex(index)} />
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