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

- `npm run test:e2e`: Playwright end-to-end tests (see Tests below). Run a single file or test with `npx playwright test e2e/gallery.spec.ts -g 'label name' --project=desktop`.
- `npm run test:e2e:photos`: regenerate the test photos in `e2e/fixtures/` (needs `exiftool`)

Running the app needs a PostgreSQL database with `sql/schema.sql` applied. The connection comes from the standard libpq env vars (`PGHOST`, `PGDATABASE`, …), because `postgres()` is called with no arguments. It also needs a photos directory. Configuration lives in `.env` (committed, non-secret defaults) and `.env.local` (secrets: `AUTH_SECRET`, `AUTH_<PROVIDER>_ID`/`AUTH_<PROVIDER>_SECRET` OAuth credentials, `ADMIN_ID`, `GOOGLE_ANALYTICS_*`, and optionally `BETTER_AUTH_URL`, the public origin). `THUMBNAIL_WIDTH` is a JSON object mapping size keys to pixel widths.

## Architecture

**Bundles are directory paths.** A bundle is a folder relative to `PHOTOS_FOLDER` (for example `/travel/Georgia/2015`). The `image.bundle` column holds that path, and the URL path is the same path.

**Request routing ([proxy.ts](proxy.ts), Next 16's replacement for middleware, which always runs on Node):**
- Any path ending in `.jpg` is rewritten to `/image/<path>`, which is handled by [app/image/[...image]/route.ts](app/image/[...image]/route.ts). That route serves the original (`?format=original`), a resized screen version (the default, capped by `SCREEN_MAX_WIDTH`), an export size (`?format=export`), or a cached WebP thumbnail (`?format=thumbnail&size=<key>`). So photo URLs look like static files, which is what lets people embed them in blog posts.
- `/history/*` requires sign-in. Filtering by a label from `RESTRICTED_LABELS` (`-filt.labels`) requires it too, but that is checked in `Gallery`, after label names and ids are resolved, because the proxy can't map ids to names.
- Other paths go to [app/[...bundle]/page.tsx](app/[...bundle]/page.tsx) (one bundle) or [app/page.tsx](app/page.tsx). With no query string, `page.tsx` shows the landing page (random-photo swiper and a bundle/label selector). With a query string, it shows a gallery across all bundles.

**Sync-on-view.** [components/gallery/index.tsx](components/gallery/index.tsx) is an async server component. When it renders a bundle without label or censorship filters, it calls `syncBundle()` from [lib/images.ts](lib/images.ts). That function compares the directory listing with the DB rows, inserts new `.jpg` files (reading their metadata with sharp and exifr), and deletes rows whose files are gone. Adding `?updatemetadata=1` to the URL re-reads metadata for every file in the bundle. If the directory is missing (`ENOENT`), the page returns 404.

**Layers:**
- [lib/db.ts](lib/db.ts): every SQL query, written as `postgres` tagged templates and typed with `sql<Row[]>`. The row interfaces live here too. Dynamic `WHERE`/`HAVING` clauses are built as arrays of `sql` fragments and joined with the local `and()` helper. Label include/exclude filters are expressed as `HAVING SUM(CASE WHEN label=… ) > 0 / = 0`. `listImages` returns `[]` when no filter is set, so it never lists the whole archive. Label names are resolved to ids with `resolveLabels()` on every request, uncached: album sync creates and deletes labels, and a stale restricted-label list would show restricted photos unblurred. Things that differ in postgres v4:
  - The default `infer: false` sends parameters untyped. Cast where the server can't infer the type (for example `${ids}::int[]`).
  - JSON values go through `sql.json()`.
  - `COUNT()` comes back as a string unless cast to `::int`.
  - `timestamp without time zone` values are written and read as UTC. Wall-clock times such as EXIF `stime` are therefore only stored correctly when the Node process runs in UTC, which is the Docker default.
  - Every query inside `sql.begin` has to be awaited before the callback returns.
- [lib/image.ts](lib/image.ts): the `Image` class. Its fields fill in lazily through `fromId`/`fromPath` → `ensurePath` → `fetchData` → `expand`. Test whether a field has been loaded with `=== undefined`, not `Object.hasOwn`: Next compiles class fields with define semantics, so declared fields always exist as own properties. It also handles metadata extraction, resizing, and thumbnail generation. Thumbnails are written to a `thumbs/` subfolder inside each bundle directory, which is why `[...bundle]/page.tsx` returns 404 for paths ending in `thumbs`.
- [lib/actions.ts](lib/actions.ts): server actions called from client components: `getImage` (the lightbox description), `getRelatedLabels`, `logView` and `logZoom`. Server actions are public endpoints that anyone can call with any arguments. So they take only ids and values the visitor chooses, validate them, check access themselves (`getImage` returns just `{ id }` for photos the visitor may not see), and read the session, IP and UA from the request, never from arguments.
- Components are server components unless they start with `'use client'`. The client ones are `album` (photo grid and lightbox), `labels`, `top/swiper`, and the GA helpers.

**Query-string filters** use the prefixes `-filt.*` and `-nav.*`: `-filt.labels` (ids or names, comma-separated), `-filt.notlabels`, `-filt.from`, `-filt.till`, `-filt.censored`, and `-nav.order`. They are parsed in `Gallery` and in [lib/meta.js](lib/meta.js), which builds page titles.

**Access control:**
- *Restricted labels* (`RESTRICTED_LABELS`, given as names or ids). Anonymous visitors still see these images, but blurred with a lock watermark (`restricted` flag → `getResized`/`makeThumbnail` with `restricted=true`, logged as `ACTION_LOCKED`), and originals return 403.
- *Censorship.* `image.censored` is compared against the visitor's level, `censorshipLevel(session)` from [auth.ts](auth.ts) (0 for anonymous visitors). Every place that lists or serves photos applies it: album listings, the random photos, the image route, downloads and the `getImage` action. Photos above the level are treated as missing (404, skipped, or an empty description), so their existence isn't revealed. `-filt.censored` can only lower the level. Files that exist on disk but aren't synced to the database yet have no level, so the image route doesn't serve them.
- *Admins.* `ADMIN_ID` lists them as comma-separated `provider:id` pairs (`isAdmin()` in [auth.ts](auth.ts), `isAdminVisitor()` in [lib/db.ts](lib/db.ts)); entries without a provider are ignored, because account ids repeat across providers. Admins can open `/history` and use `?updatemetadata=1` and thumbnail `?force=1`, and their views are not logged.

**Auth** uses Better Auth ([auth.ts](auth.ts)), mounted at [app/api/auth/[...all]/route.ts](app/api/auth/[...all]/route.ts). The route adds `BASE_PATH` back to the request URL, because Next strips it and Better Auth routes and builds redirect URIs with it. Unless `BETTER_AUTH_URL` is set, Better Auth derives its base URL from the request; with `advanced.trustedProxyHeaders` it uses `x-forwarded-host`/`x-forwarded-proto` when both are present (Next itself applies only the protocol to `request.url`).
- *Stateless.* There is no `database` option, so the session lives in an encrypted `session_data` cookie (cookie cache with the `jwe` strategy) next to the signed `session_token`. Better Auth's users, accounts and sessions are kept in an in-memory adapter that resets on restart, and nothing reads them after sign-in. Sessions can't be revoked server-side; they last 30 days.
- *Providers.* GitHub, Google and VK ID are built-in social providers. Yandex (the `yandex()` helper) and Mail.ru (custom `getUserInfo`) go through the `genericOAuth` plugin. All of them use `/api/auth/callback/<id>`, the same callback URLs as NextAuth used. Better Auth requires an e-mail, so VK accounts without one get a `<id>@vk.invalid` placeholder, which is never stored or shown. Account linking trusts all providers, because users with the same e-mail share one in-memory user.
- *Visitors.* Visitors are still identified by provider account id. The `databaseHooks.session.create.before` hook runs right after the OAuth callback: it finds the account for the provider (`context.params.id`), upserts the `visitor` row through `getUser()`, and copies `visitorId`, `provider` and `censorship` into session `additionalFields`, so they travel in the cookie. Censorship changes in the database therefore apply on next sign-in.
- *Reading the session.* Use `getSession()` (server components and route handlers; per-request `cache`) or `getSessionFromHeaders()` (the proxy). They return `{ user: Visitor }` with `user.id` being the visitor id, or `null`. Don't call `auth.api.getSession()` directly.
- *Sign-in page.* Better Auth has no UI, so [app/signin/page.tsx](app/signin/page.tsx) lists the providers and calls `signIn.social()` from the client. It accepts only local `callbackUrl` paths and shows `?error=` codes, because `onAPIError.errorURL` points to it.
- *Cookies.* Cookie names get the `__Secure-` prefix when `BETTER_AUTH_URL` is https or, when it is unset, in production. Serving production over plain http without `BETTER_AUTH_URL=http://…` therefore breaks sign-in.
- *Rate limit.* In production, Better Auth allows 3 sign-in requests per 10 seconds per IP (from `x-forwarded-for`).

**Logging/analytics.** Image views, downloads, and zooms are written to the `log` table. Thumbnails and screen images are logged by the image route; lightbox views and zooms by the `logView`/`logZoom` actions. Each row gets an `ACTION_*` code from [lib/utils.ts](lib/utils.ts), plus the client IP (from `clientIp()`, which reads `x-real-ip`/`x-forwarded-for`) and UA metadata from `ua-parser-js`. `/history` displays this log. Google Analytics events are sent through the Measurement Protocol ([lib/ga.ts](lib/ga.ts)) and `@next/third-parties`.

**`BASE_PATH`** sets the Next.js `basePath`, and it is also prepended by hand in generated image URLs, auth redirects, and the Better Auth `basePath`. When you add a URL that is built outside `<Link>`, prefix it with `BASE_PATH` too.

## Conventions

- All sources are TypeScript (`allowJs: false`). Read query strings with `param()` from [lib/utils.ts](lib/utils.ts), because any `searchParams` value can be an array.
- Client components may import types from `@/lib/db` or `@/lib/image`, but only with `import type`.
- In client code, open route handlers (such as `/download`) with `window.location.assign()`, not `router.push()`. The router fetches route handlers once more before navigating, which builds a download archive twice. It also records the URL as current while the page is still open, so server actions such as thumbnail `log()` get posted to the route handler. `BASE_PATH` isn't available in client code, so prefix such URLs with a `basePath` prop passed from the server component.
- Import from the project root with the `@/` alias (for example `@/lib/db`). The exception is [auth.ts](auth.ts), which uses relative imports because Playwright global setup loads it and doesn't resolve the alias.
- Style with plain CSS (there is no Sass). Component styles use either `*.module.css` or global `.css` files. Native CSS nesting (`&:hover`, nested selectors) is fine: Turbopack's Lightning CSS flattens it for Next's default browser targets. Comments must be `/* */`; `//` is not valid CSS. There is no webpack config; with one present, `next build` fails.
- `exifr` is listed in `serverExternalPackages` because it loads `fs` with a dynamic `require()` that breaks once bundled. A build warning "Couldn't load fs" means this has regressed.
- The landing-page swiper uses `<Image unoptimized>`. The image route already serves sized thumbnails, and since Next 16 `/_next/image` rejects local URLs with query strings unless they match `images.localPatterns`.
- Production runs in Docker on `node:24-alpine` (see [Dockerfile](Dockerfile) and [docker-compose.yaml](docker-compose.yaml)). The standalone build already embeds the Next config, so the runner stage doesn't copy `next.config.*`. It mounts `/photos` and the host PostgreSQL socket. [startup.sh](startup.sh) copies `.next/static` into `.docker/` so a front-end web server can serve static assets.

## Tests

Playwright tests live in `e2e/` and run in GitHub Actions ([.github/workflows/ci.yml](.github/workflows/ci.yml)) on every push, together with lint and typecheck. They run in two projects, `desktop` (Chrome) and `mobile` (Pixel 7). `api.spec.ts` checks HTTP responses only, so it runs only in `desktop`.

- **Environment** ([e2e/env.ts](e2e/env.ts)): it loads `.env`/`.env.local` the same way Next does, so the local PostgreSQL connection settings are reused, and then overrides everything that matters: the database (`galleria_e2e`, or `E2E_PGDATABASE`), `PHOTOS_FOLDER`, `RESTRICTED_LABELS=Private,Secret` (`Secret` exists only while a sync test adds its photo), `ADMIN_ID`, `AUTH_SECRET`, `BETTER_AUTH_URL`, dummy OAuth credentials, GA disabled and `TZ=UTC`. It refuses to run against a database whose name doesn't contain `e2e` or `test`, because global setup drops all tables.
- **Server**: `webServer` runs `npm run build && npm start` on port 3100 (`E2E_PORT`), so every run rebuilds `.next`.
- **Global setup** ([e2e/global-setup.ts](e2e/global-setup.ts)):
  - copies `e2e/fixtures/photos` to `e2e/.data/photos` (gitignored), because the app writes `thumbs/` there and tests add and remove files;
  - creates the database if it is missing, recreates the schema, and imports the albums by calling the app's own `syncBundle()`;
  - marks one photo as censored;
  - writes `e2e/.data/auth/{user,admin}.json`.
- **Auth**: OAuth can't run in CI, so `createSessions()` builds a second Better Auth instance from the app's `authOptions` with the `testUtils` plugin (no session hook) and the same secret and base URL, so cookie names and encryption match. It signs the test users in with the visitor fields set directly, then calls `getSession` to get the encrypted `session_data` cookie and saves it with `session_token` as storage states. Specs opt in with `test.use({ storageState: asUser })` (censorship 1), `asAdmin`, or `asViewer` (signed in with censorship 0). If the session fields in `auth.ts` change, update `createSessions()`. Tests that click sign-in buttons send a unique `x-forwarded-for` to stay under the rate limit; the provider pages are stubbed with `page.route`.
- **Fixtures**: synthetic JPEGs with EXIF and IPTC metadata (keywords, captions, dates, orientation), generated by [e2e/fixtures/generate-photos.mts](e2e/fixtures/generate-photos.mts) and committed. Specs assert on their exact contents, so update the specs when you change the generator. Tests that change files or logs use names unique to the project and worker, and photos without keywords, so they don't affect label counts in parallel tests.
