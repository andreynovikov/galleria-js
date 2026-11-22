import type en from './messages/en.json'

// Types message keys of `useTranslations()`/`getTranslations()` from the English messages. Other languages are
// checked against them by e2e/locale.spec.ts, since they are found at run time.
declare module 'next-intl' {
    interface AppConfig {
        Messages: typeof en
    }
}
