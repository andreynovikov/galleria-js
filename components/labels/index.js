'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

import { TagCloud } from 'react-tagcloud'

import { getRelatedLabels } from '@/lib/actions'

import './label-cloud.scss'

const options = {
    luminosity: 'dark',
    hue: '#55ACEE'
}

export default function LabelCloud({ labels }) {
    const [includedLabels, setIncludedLabels] = useState([])
    const [excludedLabels, setExcludedLabels] = useState([])
    const [relatedLabels, setRelatedLabels] = useState([])

    useEffect(() => {
        getRelatedLabels(includedLabels, excludedLabels).then(result => setRelatedLabels(result.map(label => label.id)))
    }, [includedLabels, excludedLabels])

    const router = useRouter()

    const customRenderer = (tag, size, color) => {
        const fontSize = size + 'px'
        const tagStyle = { color, fontSize }

        const isSelected = includedLabels.includes(tag.id)
        const isExcluded = excludedLabels.includes(tag.id)
        const isRelated = relatedLabels.includes(tag.id)

        const classNames = ['tag-cloud-tag']
        if (isSelected)
            classNames.push('selected')
        if (isExcluded)
            classNames.push('excluded')
        if (isRelated)
            classNames.push('related')

        return (
            <span className={classNames.join(' ')} style={tagStyle} key={tag.id}>
                {isRelated && '+'}
                {tag.name}
            </span>
        )
    }

    const handleOnPress = (tag) => {
        if (excludedLabels.includes(tag.id))
            setExcludedLabels(excluded => excluded.filter(id => id != tag.id))
        else
            setIncludedLabels(selected => {
                if (selected.includes(tag.id)) {
                    if (selected.length > 1)
                        setExcludedLabels([tag.id, ...excludedLabels])
                    else
                        setExcludedLabels([])
                    return selected.filter(id => id !== tag.id)
                } else {
                    return [tag.id, ...selected]
                }
            })
    }

    const handleButtonClick = () => {
        const uri = '/?-filt.labels=' + includedLabels.join(',') +
            (excludedLabels.length > 0 ? '&-filt.notlabels=' + excludedLabels.join(',') : '')
        console.log(uri)
        router.push(uri)
    }

    return (
        <div className="labels">
            <TagCloud
                tags={labels}
                shuffle={false}
                minSize={12}
                maxSize={22}
                colorOptions={options}
                renderer={customRenderer}
                onClick={handleOnPress} />
            {includedLabels.length > 0 && (
                <div>
                    <button className="button" onClick={handleButtonClick}>Показать</button>
                </div>
            )}
        </div>
    )
}
