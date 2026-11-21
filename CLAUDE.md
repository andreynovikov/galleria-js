# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Galleria is a self-hosted photo archive viewer (Next.js 16 App Router with Turbopack, React 19, PostgreSQL via `postgres` v4). Everything is TypeScript with `strict` on. It has no admin interface: the filesystem under `PHOTOS_FOLDER` is the source of truth, and the database is a cache of image metadata (dimensions, EXIF/IPTC captions, keywords → labels, shooting time) plus access logs. The UI text is in Russian.

## Commands

- `npm run dev`: dev server on port 3000
- `npm run build` / `npm start`: production build (`output: 'standalone'`) and serve
- `npm run lint`: `eslint .` (flat config in `eslint.config.mjs`, using `eslint-config-next`'s `core-web-vitals` and `typescript` configs). ESLint stays on 9.x because some plugins pulled in by `eslint-config-next` don't support ESLint 10 yet.
- `npm run typecheck`: runs `next typegen && tsc --noEmit`. `next typegen` generates the global `PageProps<'/route'>`, `LayoutProps` and `RouteContext` helpers that pages use, so a bare `tsc` without it fails. If it reports errors in `.next/types` for routes that no longer exist, delete the stale directories under `.next/types`.
- `npm run docker-build` / `npm run docker-deploy`: build and run the image through `docker compose` (uses `sudo`)

There is no test suite.

Running the app needs a PostgreSQL database with `sql/schema.sql` applied. The connection comes from the standard libpq env vars (`PGHOST`, `PGDATABASE`, …), because `postgres()` is called with no arguments. It also needs a photos directory. Configuration lives in `.env` (committed, non-secret defaults) and `.env.local` (secrets: `AUTH_*` OAuth credentials, `ADMIN_ID`, `GOOGLE_ANALYTICS_*`). `THUMBNAIL_WIDTH` is a JSON object mapping size keys to pixel widths.

## Architecture

**Bundles are directory paths.** A bundle is a folder relative to `PHOTOS_FOLDER` (for example `/travel/Georgia/2015`). The `image.bundle` column holds that path, and the URL path is the same path.

**Request routing ([proxy.ts](proxy.ts), Next 16's replacement for middleware, which always runs on Node):**
- Any path ending in `.jpg` is rewritten to `/image/<path>`, which is handled by [app/image/[...image]/route.ts](app/image/[...image]/route.ts). That route serves the original (`?format=original`), a resized screen version (the default, capped by `SCREEN_MAX_WIDTH`), an export size (`?format=export`), or a cached WebP thumbnail (`?format=thumbnail&size=<key>`). So photo URLs look like static files, which is what lets people embed them in blog posts.
- `/history/*`, and any request whose `-filt.labels` includes a label from `RESTRICTED_LABELS`, require sign-in.
- Other paths go to [app/[...bundle]/page.tsx](app/[...bundle]/page.tsx) (one bundle) or [app/page.tsx](app/page.tsx). With no query string, `page.tsx` shows the landing page (random-photo swiper and a bundle/label selector). With a query string, it shows a gallery across all bundles.

**Sync-on-view.** [components/gallery/index.tsx](components/gallery/index.tsx) is an async server component. When it renders a bundle without label or censorship filters, it calls `syncBundle()` from [lib/images.ts](lib/images.ts). That function compares the directory listing with the DB rows, inserts new `.jpg` files (reading their metadata with sharp and exifr), and deletes rows whose files are gone. Adding `?updatemetadata=1` to the URL re-reads metadata for every file in the bundle. If the directory is missing (`ENOENT`), the page returns 404.

**Layers:**
- [lib/db.ts](lib/db.ts): every SQL query, written as `postgres` tagged templates and typed with `sql<Row[]>`. The row interfaces live here too. Dynamic `WHERE`/`HAVING` clauses are built as arrays of `sql` fragments and joined with the local `and()` helper. Label include/exclude filters are expressed as `HAVING SUM(CASE WHEN label=… ) > 0 / = 0`. `listImages` returns `[]` when no filter is set, so it never lists the whole archive. Label name→id maps and restricted label ids are cached with `unstable_cache`. Things that differ in postgres v4:
  - The default `infer: false` sends parameters untyped. Cast where the server can't infer the type (for example `${ids}::int[]`).
  - JSON values go through `sql.json()`.
  - `COUNT()` comes back as a string unless cast to `::int`.
  - `timestamp without time zone` values are written and read as UTC. Wall-clock times such as EXIF `stime` are therefore only stored correctly when the Node process runs in UTC, which is the Docker default.
  - Every query inside `sql.begin` has to be awaited before the callback returns.
- [lib/image.ts](lib/image.ts): the `Image` class. Its fields fill in lazily through `fromId`/`fromPath` → `ensurePath` → `fetchData` → `expand`. Test whether a field has been loaded with `=== undefined`, not `Object.hasOwn`: Next compiles class fields with define semantics, so declared fields always exist as own properties. It also handles metadata extraction, resizing, and thumbnail generation. Thumbnails are written to a `thumbs/` subfolder inside each bundle directory, which is why `[...bundle]/page.tsx` returns 404 for paths ending in `thumbs`.
- [lib/actions.ts](lib/actions.ts): server actions called from client components (`getImage`, `getRelatedLabels`, `log`).
- Components are server components unless they start with `'use client'`. The client ones are `album` (photo grid and lightbox), `labels`, `top/swiper`, and the GA helpers.

**Query-string filters** use the prefixes `-filt.*` and `-nav.*`: `-filt.labels` (ids or names, comma-separated), `-filt.notlabels`, `-filt.from`, `-filt.till`, `-filt.censored`, and `-nav.order`. They are parsed in `Gallery` and in [lib/meta.js](lib/meta.js), which builds page titles.

**Access control:**
- *Restricted labels* (`RESTRICTED_LABELS`, given as names or ids). Anonymous visitors still see these images, but blurred with a lock watermark (`restricted` flag → `getResized`/`makeThumbnail` with `restricted=true`, logged as `ACTION_LOCKED`), and originals return 403.
- *Censorship.* `image.censored` is compared against `visitor.censorship`. Anonymous visitors see only `censored = 0`.
- *Admins.* `ADMIN_ID` (comma-separated provider account ids) can open `/history`, and their views are not logged.

**Auth** uses NextAuth v5 beta. [auth.config.ts](auth.config.ts) holds the provider list (GitHub, Google, Mail.ru, Yandex, and VK with a custom token `conform` shim) and is shared with the proxy. [auth.ts](auth.ts) adds callbacks that upsert a `visitor` row and merge it into the session. The `Session.user` and `JWT` types are augmented in [types/next-auth.d.ts](types/next-auth.d.ts). JWT augmentation has to target `@auth/core/jwt`, because `next-auth/jwt` only re-exports it.

**Logging/analytics.** Image views, downloads, and zooms are written to the `log` table with an `ACTION_*` code from [lib/utils.ts](lib/utils.ts), plus the client IP (from `clientIp()`, which reads `x-real-ip`/`x-forwarded-for`) and UA metadata from `ua-parser-js`. `/history` displays this log. Google Analytics events are sent through the Measurement Protocol ([lib/ga.ts](lib/ga.ts)) and `@next/third-parties`.

**`BASE_PATH`** sets the Next.js `basePath`, and it is also prepended by hand in generated image URLs, auth redirects, and the NextAuth `basePath`. When you add a URL that is built outside `<Link>`, prefix it with `BASE_PATH` too.

## Conventions

- All sources are TypeScript (`allowJs: false`). Read query strings with `param()` from [lib/utils.ts](lib/utils.ts), because any `searchParams` value can be an array.
- Client components may import types from `@/lib/db` or `@/lib/image`, but only with `import type`.
- Import from the project root with the `@/` alias (for example `@/lib/db`).
- Style with SCSS. Component styles use either `*.module.scss` or plain `.scss`, compiled by Turbopack. There is no webpack config; with one present, `next build` fails.
- `exifr` is listed in `serverExternalPackages` because it loads `fs` with a dynamic `require()` that breaks once bundled. A build warning "Couldn't load fs" means this has regressed.
- The landing-page swiper uses `<Image unoptimized>`. The image route already serves sized thumbnails, and since Next 16 `/_next/image` rejects local URLs with query strings unless they match `images.localPatterns`.
- Production runs in Docker on `node:24-alpine` (see [Dockerfile](Dockerfile) and [docker-compose.yaml](docker-compose.yaml)). The standalone build already embeds the Next config, so the runner stage doesn't copy `next.config.*`. It mounts `/photos` and the host PostgreSQL socket. [startup.sh](startup.sh) copies `.next/static` into `.docker/` so a front-end web server can serve static assets.
