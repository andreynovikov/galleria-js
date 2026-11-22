'use client'

import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'

import { loadHistory } from '@/app/history/actions'

import type { HistoryQuery } from './days'

interface MoreHistoryProps {
    /** `before` of the next page, `null` when there is none */
    next: string | null
    query: HistoryQuery
}

/** Loads older pages of `/history` as the visitor scrolls towards the end */
export default function MoreHistory({ next, query }: MoreHistoryProps) {
    const [pages, setPages] = useState<ReactNode[]>([])
    const [cursor, setCursor] = useState(next)
    const [loading, setLoading] = useState(false)
    const [failed, setFailed] = useState(false)
    const sentinel = useRef<HTMLDivElement>(null)

    // A new observer reports at once whether the end is still in view, so short pages are followed by the next one
    useEffect(() => {
        const element = sentinel.current
        if (cursor === null || loading || failed || element === null)
            return
        const observer = new IntersectionObserver(entries => {
            if (!entries.some(entry => entry.isIntersecting))
                return
            observer.disconnect()
            setLoading(true)
            loadHistory(cursor, query)
                .then(result => {
                    if (result === null) {
                        setCursor(null)
                        return
                    }
                    setPages(pages => [...pages, result.content])
                    setCursor(result.next)
                })
                .catch(() => setFailed(true))
                .finally(() => setLoading(false))
        }, { rootMargin: '600px' })
        observer.observe(element)
        return () => observer.disconnect()
    }, [cursor, loading, failed, query])

    return (
        <>
            {pages.map((page, index) => <Fragment key={index}>{page}</Fragment>)}
            {cursor !== null && (
                <div ref={sentinel} className="more">
                    {loading && 'Загрузка…'}
                    {failed && <button className="button" onClick={() => setFailed(false)}>Загрузить ещё</button>}
                </div>
            )}
        </>
    )
}
