# Galleria development instructions

## Scope and workflow

- This file contains repository-specific guidance. Global development preferences live in `~/.codex/AGENTS.md`; do not duplicate them here.
- Galleria is a self-hosted photo archive viewer, with no admin UI. Files under `PHOTOS_FOLDER` are the source of truth; PostgreSQL caches photo metadata and stores visitors and access logs.
- Use English for code comments, explaining non-obvious behavior for an experienced developer without overcommenting. Keep README setup instructions accessible to gallery owners with basic technical skills; keep examples and put developer material at the end.
- Commit only when requested. SQL migrations for existing databases belong in `sql/migrations/`, remain uncommitted, and must not be documented in the README; the owner applies them manually. Update `sql/schema.sql` for fresh databases when changing the schema. Do not stage existing untracked migrations with unrelated work.
- `PROBLEMS.md` and `TODO.md` were intentionally removed; do not recreate their historical issue lists. If a task supplies a new local `PROBLEMS.md`, mark resolved headings `— FIXED`, add a `Fixed:` paragraph, retain a `Still open:` note for remaining work, and mark resolved sub-bullets `~~…~~ FIXED`. Remove resolved entries only when requested.

## Stack and commands

Next.js 16 App Router with Turbopack, React 19, strict TypeScript (`allowJs: false`), PostgreSQL through `postgres` v4, Better Auth, next-intl, sharp and exifr. Docker and CI use Node 24. Use npm and the committed lockfile. Keep ESLint on 9.x for plugin compatibility; TypeScript is on major 6.

| Command | Purpose |
| --- | --- |
| `npm ci` | Install locked dependencies |
| `npm run dev` | Development server on port 3000 |
| `npm run build` / `npm start` | Standalone production build / local production server |
| `npm run lint` | ESLint flat configuration in `eslint.config.mjs` |
| `npm run typecheck` | `next typegen && tsc --noEmit` |
| `npm run test:e2e` | Main Playwright suite |
| `npx playwright test e2e/gallery.spec.ts -g 'label name' --project=desktop` | Selected test |
| `npm run test:e2e:nginx` | README nginx configuration with `BASE_PATH=/photos` |
| `npm run test:e2e:photos` | Regenerate committed JPEG fixtures; requires exiftool |
| `npm run docker-build` / `npm run docker-deploy` | Compose build / deployment; scripts use sudo |

- Run lint and typecheck for code changes and Playwright coverage relevant to the changed behavior. CI runs lint, typecheck, the main suite and nginx tests on pushes.
- Use `npm run typecheck`, not bare `tsc`: pages depend on generated `PageProps`, `LayoutProps` and `RouteContext`. If removed routes leave errors in `.next/types`, remove only the stale generated route directories and regenerate.
- Local startup needs PostgreSQL initialized with `sql/schema.sql` and a photos directory. Connections use libpq variables (`PGHOST`, `PGDATABASE`, etc.); `lib/db.ts` sets the database session time zone to UTC.
- `.env` holds committed non-secret defaults; `.env.local` holds local connection settings, `AUTH_SECRET`, OAuth credentials, `ADMIN_ID`, optional `BETTER_AUTH_URL` and analytics settings. `THUMBNAIL_WIDTH` is a JSON map of size keys to widths. See README for configuration and deployment details.

## Architecture and routing

- A bundle is a directory relative to `PHOTOS_FOLDER`, such as `/travel/Georgia/2015`; the same plain path is stored in `image.bundle` and represented in the URL.
- `proxy.ts` is the Node-runtime Next.js request proxy. It rewrites `.jpg` URLs to `app/image/[...image]/route.ts`, preserving embeddable photo URLs. Formats are original, default screen resize, export and cached WebP thumbnail (`?format=thumbnail&size=<key>`).
- `app/[...bundle]/page.tsx` renders a bundle. `app/page.tsx` shows the landing swiper and selector without a query string, or a cross-bundle gallery with one. Paths ending in `thumbs` return 404.
- `components/gallery/index.tsx` handles query filters and access checks. Keep sign-in redirects and missing-bundle checks before streaming the header: status codes cannot change after streaming starts. `GalleryPhotos` runs under Suspense, waits up to two seconds for sync, and registers longer work with `after()` while displaying imported photos and a sync notice.
- Filters use `-filt.labels` (names or ids), `-filt.notlabels`, `-filt.from`, `-filt.till`, `-filt.censored` and `-nav.order`. Read values with `param()` from `lib/utils.ts`, since query parameters can be arrays. Page titles are built in `lib/meta.ts`.
- Components are server components unless marked `'use client'`. Client imports from database/image modules must be `import type`. Use `@/` imports; `auth.ts` uses relative imports because Playwright global setup loads it outside Next's alias resolution.
- `lib/image.ts` owns metadata extraction, resizing, thumbnails and lazy `Image` loading (`fromId`/`fromPath`, `ensurePath`, `fetchData`, `expand`). Test unloaded fields with `=== undefined`, not `Object.hasOwn`: compiled class fields already exist as own properties.
- `lib/actions.ts` contains public server actions. Validate caller input and enforce access in each action; accept only visitor-chosen ids/values and derive session, IP and user agent from the request. `getImage` returns only `{ id }` when access is denied.

## Filesystem synchronization

- `lib/images.ts` scans at startup and every `SYNC_INTERVAL_MINUTES` via `instrumentation.ts`; zero disables scanning. Skip hidden directories and `thumbs`, follow symlinks once, and preserve the database if scanning fails or finds no bundles (for example, an unmounted disk).
- Unfiltered bundle views call `syncBundleOnView()`. An unchanged folder mtime and a sync less than a minute old allow a cheap `stat` check; otherwise synchronize the directory. Missing directories return 404.
- Sync imports new JPGs, deletes missing rows and thumbnails, and rereads metadata and removes thumbnails when size or mtime changes. Skip files modified within the last minute because copying may be incomplete. Legacy rows without file versions get their versions recorded without rereading metadata unless forced.
- Keep one in-flight sync per bundle using the shared promise map on `globalThis`, and preserve the unique `(bundle, name)` database constraint. Each photo's row, metadata and labels must be written atomically in its own transaction: interrupted background work must resume safely.
- `?updatemetadata=1` forces metadata rereads for admins only. Do not make correctness depend on `after()` completing. `startup.sh` uses `exec node` and Compose allows 30 seconds for graceful shutdown.

## SQL, caching and dates

- Keep SQL and row interfaces in `lib/db.ts`. Use typed `postgres` tagged templates (`sql<Row[]>`), SQL fragments and the local `and()` helper for dynamic conditions. Await every query inside `sql.begin` before its callback returns.
- postgres v4 uses `infer: false`: cast ambiguous parameters explicitly (such as `${ids}::int[]`), use `sql.json()` for JSON, and cast `COUNT()` to `::int` when a number is needed.
- Preserve `listImages()` returning `[]` when no filter is set, to avoid fetching the whole archive. Include/exclude label filtering uses `HAVING` conditions; related labels intersect per-label index lookups rather than grouping all of `label_image`.
- Resolve label names and restricted labels on every request. Caching them can expose newly restricted photos after sync creates or deletes labels. Landing bundle/label lists alone use a five-minute cache keyed by censorship level; any photo or label mutation must call `invalidateListings()`.
- Resized screen images use the bounded in-memory LRU `BufferCache` in `lib/cache.ts`, controlled by `SCREEN_CACHE_MB` (default 256, zero disables storage). Concurrent requests share generation. Preserve cache keys distinguishing file versions, dimensions and locked variants.
- The owner requires logs for server hits, while browser cache hits need no log. Keep resize caching inside the app so requests still pass through logging; do not introduce a disk copy of every screen image or a shared response cache that bypasses the app. Thumbnails intentionally live in each bundle's `thumbs/` directory.
- Time handling must be independent of the host zone. `image.mtime` and `image.ctime` are moments (`timestamptz`). `image.stime` and date filters are camera wall-clock times (`timestamp`), represented in JavaScript by a Date whose UTC fields hold that time.
- Parse camera/filter dates with `parseDate()` in `lib/utils.ts`, never local-zone `new Date(string)` or exifr revived dates; retain `reviveValues: false`. `log.ctime` remains a non-null UTC `timestamp` partition key; log months/days use UTC, with `moment.utc()` for history day calculations. Format dates with next-intl in UTC.

## Access, authentication and response safety

- Restricted labels and censorship are separate. Anonymous visitors see restricted photos blurred with a lock watermark, but originals return 403; filtering by restricted labels requires sign-in after resolving names/ids in Gallery.
- Photos above `censorshipLevel(session)` must appear absent everywhere: listings, random photos, image routes, downloads and actions. Anonymous level is zero; `-filt.censored` may only lower the visitor's level. Do not serve files that have not yet been synced to the database.
- Admin identities are comma-separated `provider:id` pairs in `ADMIN_ID`; bare ids are ignored because providers can reuse ids. Use `isAdmin()`/`isAdminVisitor()`. History access, metadata refresh and thumbnail `?force=1` are admin-only; admin views are not logged. History actions must check access themselves.
- Images that depend on visitor access use `Cache-Control: private, no-cache` and `Vary: Cookie`; other images use `public, max-age=3600`. URLs carry no visitor id. ETags include file version and, for resized images, width and lock state; originals/thumbnails have strong ETags and resized images weak ones.
- Preserve early conditional responses before resizing, single-range support for unchanged file responses, and logging only ranges starting at byte zero. Do not send `Last-Modified` for restricted/censored images: locked and unlocked variants share an mtime, so date revalidation can retain the wrong variant.
- `auth.ts` configures Better Auth without a database adapter: encrypted `session_data` and signed `session_token` cookies carry sessions; its in-memory users/accounts disappear on restart. Sessions last 30 days and cannot be revoked server-side. Database censorship changes take effect on the next sign-in.
- Read sessions through `getSession()` (cached per request) or `getSessionFromHeaders()` (proxy), returning `{ user: Visitor }` or null. Do not bypass these wrappers with `auth.api.getSession()` in application callers.
- Keep provider accounts separate via `accountUser()` and synthetic `<provider>-<id>@accounts.invalid` addresses; account linking stays disabled. Actual provider email is `contactEmail`, which must remain an input-capable additional user field because Better Auth drops provider fields marked `input: false`. The provider overwrites it at sign-in.
- The session creation hook upserts the visitor with `getUser()` and copies `visitorId`, `provider` and `censorship` into session fields. Update test session creation whenever these fields change.
- GitHub, Google and VK ID are built-in providers; Yandex and Mail.ru use `genericOAuth`. Preserve `/api/auth/callback/<id>` URLs and the auth route's restoration of `BASE_PATH` stripped by Next.
- `BETTER_AUTH_URL` should be the public origin; otherwise trusted forwarded host/protocol headers determine it. Production plain HTTP needs an explicit HTTP origin or secure-prefixed cookies break sign-in. Sign-in callback paths must remain local. Production sign-in is limited to three requests per ten seconds per IP.

## URLs, UI and deployment constraints

- Disk/database paths are plain, URLs percent-encoded. Use `urlPath()` to build paths and `decodePath()` to read catch-all/pathname values; preserve rejection of traversal, encoded separators and malformed encodings. The proxy returns 400 for malformed encodings before Next can turn them into 500s.
- Prefix URLs built outside Next `<Link>` with `BASE_PATH`, including images and auth redirects. For client navigation to route handlers such as `/download`, use `window.location.assign()` with a server-supplied `basePath` prop. `router.push()` can build archives twice and misdirect subsequent server actions.
- ZIP downloads require sign-in, validate/deduplicate ids, enforce `DOWNLOAD_MAX_IMAGES`, skip inaccessible/missing photos, and disambiguate case-insensitive filename collisions using bundle paths. Preserve streaming backpressure, cancellation on disconnect and bounded preparation. Reuse existing resize cache entries without populating it from bulk downloads.
- Use plain CSS/modules with native nesting and `/* */` comments; no Sass or webpack configuration. Keep exifr in `serverExternalPackages`; a build warning `Couldn't load fs` indicates bundling has regressed. The landing swiper uses `<Image unoptimized>` because the image route already sizes thumbnails.
- Page CSP comes from `proxy.ts` and `lib/csp.ts`. New inline/external scripts need the per-request nonce; new external APIs need `connect-src` entries. The root layout reads `x-nonce`, keeping pages request-rendered. `CSP_NONCE=report` reports nonce violations while enforcing the older policy; `enforce` enables nonce enforcement and is used in e2e.
- Keep `report-uri` reporting to `app/api/csp-report/route.ts` with hourly deduplication; adding `report-to` changes browser reporting behavior. Image responses have no CSP. Request Client Hints on pages only, using runtime `CLIENT_HINTS`; do not add `Critical-CH`, which caused duplicate requests.
- Image actions use `ACTION_*` codes, request IP via `clientIp()` and UA metadata via `uaMeta()`. History loads weeks incrementally. `lib/log-retention.ts` runs at startup and daily, maintains this month's and the next two monthly partitions, and expires whole old months and old `log_default` rows using `LOG_RETENTION_DAYS` (zero retains indefinitely). Move default-partition rows under a lock before attaching a monthly partition.
- Docker uses the standalone build, `/photos`, the host PostgreSQL socket and `.docker/` static assets copied by `startup.sh`. Do not copy Next config into the runner; it is embedded in the build. Keep `.env.local` excluded from the build context, mounted only as a BuildKit secret for the build, and passed through runtime `env_file`.

## Localization

- Use next-intl without locale routing or a language selector. `i18n/request.ts` chooses the highest-priority available primary language from `Accept-Language`, honoring lower-ranked supported choices before falling back to English. Missing messages also fall back to English.
- Languages are discovered from `i18n/messages/<language>.json`; adding one needs no locale registry. `en.json` defines typed keys. Add new keys to every committed translation; `e2e/locale.spec.ts` verifies parity.
- Use whole ICU phrases for pluralization and word order. Use `=1` for exact singular choices: Russian `one` also includes 21, 31, etc. Use next-intl translation/formatting APIs, not moment formatting; no moment locale is loaded.
- Pass Lightbox messages unformatted using its own English label keys; the lightbox interpolates its placeholders. Preserve request-local `<html lang>` and UTC formatting.
- Keep pages private and `no-store`: Next replaces proxy `Vary` headers, so relying on `Vary: Accept-Language` alone is unsafe.

## Playwright verification

- See `e2e/env.ts`, `e2e/global-setup.ts` and both Playwright configs. Tests reuse local libpq connection settings but override the database, photo root, auth, admin/restricted labels, analytics and timezone. Global setup drops all tables: use only the dedicated `galleria_e2e` database or `E2E_PGDATABASE` containing `e2e` or `test`; never weaken the name guard.
- Main tests build and start production on port 3100 (`E2E_PORT`), without server reuse. Both suites rebuild `.next` and reset shared test data; run them sequentially. Tests use `TZ=America/New_York` to expose local-time assumptions, `CSP_NONCE=enforce` and `SYNC_INTERVAL_MINUTES=0` to prevent background scan races.
- Projects are desktop Chromium and mobile Pixel 7, generally with `ru-RU`. Keep explicit Russian UI assertions; locale tests separately cover English, fallback behavior, translation keys and cache headers. Accounts/API/dates/locale/log specs are desktop-only; nginx has its own config.
- Setup copies committed synthetic JPEG fixtures into disposable `e2e/.data/photos`, applies schema and imports via `syncBundle()`, then marks censored fixtures. Update specs when changing generated metadata. Use project/worker-unique filenames and log identifiers, photos without keywords for unrelated mutations, and `settled()` for added files to clear the one-minute import delay.
- Test sessions come from a Better Auth instance using `authOptions` plus `testUtils`, matching cookie secret/origin and explicitly setting visitor fields. Both cookies are required. Use `asUser` (censorship 1), `asAdmin` or `asViewer` (signed in, level 0). Provider APIs are stubbed in account tests; sign-in tests use unique forwarded IPs to avoid rate-limit interference.
- nginx tests use `/usr/sbin/nginx` (or `NGINX`) as the current user, files under `e2e/.nginx`, public port 3200 and `BASE_PATH=/photos`. `e2e/nginx/config.mts` derives configuration from README blocks: change the generator and examples together when necessary. Tests use separate loopback addresses for logs/rate limits. Keep `BETTER_AUTH_URL` an origin, with no path.

## Migration sources

Consolidated from repository `CLAUDE.md`, `~/.claude/CLAUDE.md`, and the Galleria project memory directory under `~/.claude/projects/-home-andrey-Workspace-galleria-js/memory/` (`MEMORY.md`, `check-sbin-before-missing.md`, `galleria-security-fix-workflow.md`). Repository session records were consulted for corrections and decisions, and current source/configuration checked for drift. Global preferences were already covered by `~/.codex/AGENTS.md`. Original Claude files remain unchanged.
