'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

import { TagCloud, type ColorOptions, type Tag } from 'react-tagcloud'

import { getRelatedLabels } from '@/lib/actions'
import type { LabelCount } from '@/lib/db'

import './label-cloud.scss'

const options: ColorOptions = {
    luminosity: 'dark',
    hue: '#55ACEE'
}

type LabelTag = Tag & LabelCount

interface LabelCloudProps {
    labels: LabelCount[]
}

export default function LabelCloud({ labels }: LabelCloudProps) {
    const [includedLabels, setIncludedLabels] = useState<number[]>([])
    const [excludedLabels, setExcludedLabels] = useState<number[]>([])
    const [relatedLabels, setRelatedLabels] = useState<number[]>([])

    useEffect(() => {
        getRelatedLabels(includedLabels, excludedLabels).then(result => setRelatedLabels(result.map(label => label.id)))
    }, [includedLabels, excludedLabels])

    const router = useRouter()

    const tags: LabelTag[] = labels.map(label => ({ ...label, value: label.name, key: String(label.id) }))

    const customRenderer = (tag: LabelTag, size: number, color: string) => {
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

    const handleOnPress = (tag: LabelTag) => {
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
        router.push(uri)
    }

    return (
        <div className="labels">
            <TagCloud
                tags={tags}
                shuffle={false}
                minSize={12}
                maxSize={22}
                colorOptions={options}
                renderer={(tag, size, color) => customRenderer(tag as LabelTag, size, color)}
                onClick={(tag: Tag) => handleOnPress(tag as LabelTag)} />
            {includedLabels.length > 0 && (
                <div>
                    <button className="button" onClick={handleButtonClick}>Показать</button>
                </div>
            )}
        </div>
    )
}
