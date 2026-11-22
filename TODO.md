# TODO

## Support different locales

The interface is in Russian only, which limits who can run their own gallery. Make the interface language configurable for the whole gallery (an env setting such as `LOCALE`, Russian by default), and maybe chosen per visitor from `Accept-Language` later.

What depends on the language now:
- **Interface text**, hardcoded in components and pages: the sign-in page and its error messages (`app/signin/page.tsx`, `components/signin`), album and label buttons (`components/album`, `components/labels`, `components/selector`), the sync notice and "all albums" link (`components/gallery`), page titles (`app/page.tsx`, `app/[...bundle]/page.tsx`), and the history's loading text (`components/history/more.tsx`).
- **Page titles built from filters** in `lib/meta.ts` ("с тегами", "после", "до"), which also depend on word order and plural forms, so they need whole-phrase translations rather than words joined together.
- **Dates.** moment formats them with `LL`/`LLL` (`lib/meta.ts`, `components/history/days.tsx`), but no moment locale is loaded, so they come out in English next to Russian text already. Load the locale that matches the interface, or switch to `Intl.DateTimeFormat`.
- **Provider names**: Yandex is named "Яндекс" in `auth.ts`.
- **`<html lang="ru">`** in `app/layout.tsx`, and the lightbox's button labels (yet-another-react-lightbox `labels`), which are in English now.
- **The e2e tests** run with `locale: 'ru-RU'` and assert on Russian text, so they should pick the text up from the same translations.

Photo captions, keywords and album names come from the files and stay as they are.
