/**
 * The project's language: the one of visitors whose browser accepts no language with a message file in
 * `i18n/messages`, and of messages a translation lacks
 */
export const defaultLocale = 'en'

/**
 * Primary language subtags of an `Accept-Language` header, most preferred first (`ru` for `ru-RU`). Ranges with
 * `q=0` are left out, and so is everything after `*`: it stands for any language, so the default one does too.
 */
export function preferredLanguages(acceptLanguage: string | null | undefined): string[] {
    if (!acceptLanguage)
        return []
    const ranges = acceptLanguage.split(',').map((range, index) => {
        const [tag, ...params] = range.split(';').map(part => part.trim())
        const q = params.find(param => param.toLowerCase().startsWith('q='))
        const quality = q === undefined ? 1 : Number(q.slice(2))
        return { language: tag.split('-')[0].toLowerCase(), quality: Number.isFinite(quality) ? quality : 0, index }
    })
    // Equal quality values keep the order of the header; malformed tags are skipped, so they can't name a file
        .filter(({ language, quality }) => quality > 0 && (language === '*' || /^[a-z]{2,3}$/.test(language)))
        .sort((a, b) => b.quality - a.quality || a.index - b.index)
    const languages: string[] = []
    for (const { language } of ranges) {
        if (language === '*')
            break
        if (!languages.includes(language))
            languages.push(language)
    }
    return languages
}

export interface Messages {
    [key: string]: string | Messages
}

/** `messages` with whatever they lack taken from `fallback`, nested namespaces included */
export function withFallback(messages: Messages, fallback: Messages): Messages {
    const result: Messages = { ...fallback }
    for (const [key, value] of Object.entries(messages)) {
        const base = fallback[key]
        result[key] = typeof value === 'object' && typeof base === 'object' ? withFallback(value, base) : value
    }
    return result
}
