import { headers } from 'next/headers'
import { getRequestConfig } from 'next-intl/server'

import en from './messages/en.json'
import { defaultLocale, preferredLanguages, withFallback, type Messages } from './locales'

/**
 * Dates are formatted in UTC, whatever the zone of the server: the ones shown are wall-clock times (the
 * `-filt.from`/`-filt.till` filters, read by `parseDate()`) and the UTC days of the access log
 */
const timeZone = 'UTC'

/**
 * Messages of a language, `undefined` if it has no file. The bundler includes every `i18n/messages/*.json` file
 * for this import, so a new language needs only its file. `language` is a bare subtag (`preferredLanguages`).
 */
async function loadMessages(language: string): Promise<Messages | undefined> {
    try {
        return (await import(`./messages/${language}.json`)).default
    } catch {
        return undefined
    }
}

// Loaded by next-intl (through the `next-intl/config` alias of its Next plugin) once per request. The language
// follows the visitor's browser: the most preferred language that has a translation. Everything else falls back
// to English: the language when the browser accepts none with a translation, and messages a translation lacks.
export default getRequestConfig(async () => {
    for (const language of preferredLanguages((await headers()).get('accept-language'))) {
        if (language === defaultLocale)
            break
        const messages = await loadMessages(language)
        if (messages !== undefined)
            return { locale: language, messages: withFallback(messages, en) as typeof en, timeZone }
    }
    return { locale: defaultLocale, messages: en, timeZone }
})
