[![CI](https://github.com/andreynovikov/galleria-js/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/andreynovikov/galleria-js/actions/workflows/ci.yml)

## Introduction

Galleria is a responsive and mobile friendly web application designed for presentation and management of self-hosted photo archive. The main ideas behind it are:

1. No administrative interface, everything is managed via image files (backed by database for responsiveness)
2. Photos are grouped in bundles (galleries)
3. Photos can be filtered by many criteria (tags, authors, shooting dates), also across bundles
4. Each bundle can contain hundreds of photos
5. Friendly URLs for easy blogging
6. Anonymous access can be restricted

## Examples

* [Entrance page with selection by label](https://newf.ru/photos)
* [Huge bundle with hundreds of photos](https://newf.ru/photos/travel/Georgia/2015)
* [Bundle filtered by shooting time](https://newf.ru/photos/travel/Georgia/2015?-filt.from=2015-06-25&-filt.till=2015-06-26)
* [All photos filtered by label](https://newf.ru/photos/?-filt.labels=10&-filt.notlabels=13)
* [Photos filtered by named labes](https://newf.ru/photos?-filt.labels=Омало,Таня)
* [Single photo, original image file, huge](https://newf.ru/photos/travel/Georgia/2015/IMG_2171.JPG?format=original)
* [Single photo, optimized](https://newf.ru/photos/travel/Georgia/2015/IMG_2171.JPG)
* [Single thumbnail](https://newf.ru/photos/travel/Georgia/2015/IMG_2171.JPG?format=thumbnail)

Last two examples are useful for blogging – photos can be inserted in text as if they are static.

## Maintenance

New and removed files are picked up automatically when a bundle is viewed. Two URL parameters force more expensive work and are available only to administrators, listed in `ADMIN_ID` as comma-separated `provider:id` pairs (for example `ADMIN_ID=github:12345,vk:67890`). For other visitors they are ignored.

* `?updatemetadata=1` on a bundle page re-reads metadata (dimensions, captions, keywords, shooting time) of every photo in the bundle
* `?format=thumbnail&force=1` on a photo regenerates its cached thumbnail

## Requirements

* Node.js
* PostgreSQL

## Deployment

Galleria runs in Docker on the same host as PostgreSQL and the photo archive, behind a front web server that handles HTTPS. You need Docker with Compose v2 and BuildKit (the default in current Docker releases).

### 1. Prepare the host

* **Database.** Create a PostgreSQL database and apply the schema: `psql -d galleria -f sql/schema.sql`. The container connects through the host's socket, mounted at `/var/run/postgresql`.
  * The container runs as the `node` user (uid 1000).
  * With `peer` authentication, PostgreSQL sees the container as the host user with uid 1000, so that user needs a database role.
  * Alternatively, use password authentication and set `PGUSER` and `PGPASSWORD`.
* **Photos.** The archive is mounted from `/photos` (change the volume in [docker-compose.yaml](docker-compose.yaml) if it lives elsewhere). Uid 1000 needs write access to the album folders, because thumbnails are written to a `thumbs/` subfolder in each of them.

### 2. Configure

Settings come from two files:
* `.env`: committed, non-secret defaults (image sizes, the download limit and `SCREEN_CACHE_MB`, the memory kept for resized photos).
* `.env.local`: your deployment's settings and secrets. Create it next to `docker-compose.yaml`; it is never committed and never copied into the image.

```sh
PGHOST=/var/run/postgresql
PGDATABASE=galleria
PHOTOS_FOLDER=/photos

# Public origin, without BASE_PATH
BETTER_AUTH_URL=https://example.com
# Only if the app is served under a path prefix
BASE_PATH=/photos
# Generate with: openssl rand -base64 32
AUTH_SECRET=…

# OAuth apps, for each provider you use: github, google, yandex, mailru, vk
AUTH_GITHUB_ID=…
AUTH_GITHUB_SECRET=…

# Administrators as provider:id pairs, see Maintenance
ADMIN_ID=github:12345
# Photos with these labels (names or ids) are blurred for anonymous visitors
RESTRICTED_LABELS=Private
# Optional
GOOGLE_ANALYTICS_ID=…
GOOGLE_ANALYTICS_API_SECRET=…
```

Register `<BETTER_AUTH_URL><BASE_PATH>/api/auth/callback/<provider>` as the callback URL in each OAuth app (for example `https://example.com/photos/api/auth/callback/github`).

Over HTTPS, the session cookies get the `__Secure-` prefix. If you serve the app over plain HTTP, set `BETTER_AUTH_URL` to its `http://` address, or signing in won't work.

### 3. Build and run

```sh
npm run docker-build    # builds the image, tagged galleria and galleria:<version>
npm run docker-deploy   # starts or recreates the container
```

Both scripts call `docker compose` through `sudo`.

`.env.local` is used twice, and never stored in the image:
* **During the build,** it is mounted as a build secret, because `BASE_PATH` is fixed at build time and the build loads the auth configuration.
* **At runtime,** it is passed to the container with `env_file`.

When you change `.env.local`, rebuild if you changed `BASE_PATH`. For any other setting, `npm run docker-deploy` is enough.

The app listens on `127.0.0.1:3000`. Logs go to the systemd journal: `journalctl CONTAINER_NAME=nextjs-galleria`.

### 4. Front web server

The app listens on `127.0.0.1:3000` only, behind a front web server, which has to:
* **Pass the client address.** Set `X-Real-IP` to it and overwrite `X-Forwarded-For` instead of appending to it. The app trusts these headers for access logs, `/history` and the sign-in rate limit, so a value sent by the client must never reach it. If the web server is itself behind a CDN or another proxy, restore the client address first (nginx `set_real_ip_from` and `real_ip_header`).
* **Pass `X-Forwarded-Host` and `X-Forwarded-Proto`,** which are used to build sign-in redirects when `BETTER_AUTH_URL` is not set.
* **Limit request rates.** Screen and export versions are resized on request, a first view of an album generates its thumbnails, and server actions (lightbox descriptions, view and zoom logging, related labels) are public endpoints. The app limits only sign-in attempts itself.
* **Not buffer album downloads,** so the archive is built only as fast as the client receives it.
* **Not cache `*.jpg` responses:** views are logged only when requests reach the app.
* **Not add security headers.** The app sends its own `Content-Security-Policy`, and duplicate policies are both enforced.

Static assets are copied to `.docker/static/` next to `docker-compose.yaml` on every start, so the web server can serve them directly.

An nginx example for `BASE_PATH=/photos`. The proxy settings shared by its locations go into a file of their own, `/etc/nginx/snippets/galleria-proxy.conf`:

```nginx
proxy_pass http://127.0.0.1:3000;
proxy_set_header Host $host;
# Overwritten, never appended to: the app trusts them
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
```

In the `http` block, the rate limit zones (per client address):

```nginx
# Pages and server actions (POST requests to page URLs)
limit_req_zone $binary_remote_addr zone=galleria_requests:10m rate=10r/s;
# All photo URLs: opening and scrolling a large album loads hundreds of thumbnails
limit_req_zone $binary_remote_addr zone=galleria_images:10m rate=20r/s;
# Screen and export versions, which are resized on request (requests with an empty key are not limited)
map $arg_format $galleria_resize_key {
    thumbnail "";
    original  "";
    default   $binary_remote_addr;
}
limit_req_zone $galleria_resize_key zone=galleria_resize:10m rate=5r/s;
limit_req_status 429;
```

In the `server` block:

```nginx
# The landing page. Without an exact location, nginx would redirect /photos to /photos/, and Next back
location = /photos {
    include snippets/galleria-proxy.conf;
    limit_req zone=galleria_requests burst=100 nodelay;
}

location /photos/ {
    include snippets/galleria-proxy.conf;
    limit_req zone=galleria_requests burst=100 nodelay;
}

location ~* ^/photos/.+\.jpg$ {
    include snippets/galleria-proxy.conf;
    limit_req zone=galleria_images burst=300 nodelay;
    limit_req zone=galleria_resize burst=30 nodelay;
}

location = /photos/download {
    include snippets/galleria-proxy.conf;
    limit_req zone=galleria_requests burst=100 nodelay;
    # Otherwise nginx reads the whole archive into a temporary file as fast as the app can make it
    proxy_buffering off;
}

location ^~ /photos/_next/static/ {
    alias /path/to/galleria-js/.docker/static/;
    expires 1y;
}
```

The rates allow fast scrolling and flipping through the lightbox from one address; raise them if many visitors share one (an office or a mobile carrier NAT). Rejected requests get 429.

Resized screen and export versions are kept in memory, up to `SCREEN_CACHE_MB` megabytes (256 by default, 0 turns it off), so leave the container that much memory on top of what Node needs.

### Updating

```sh
git pull
npm run docker-build
npm run docker-deploy
```

New photos are imported when their album is first viewed. A page waits up to 2 seconds for the import, and a larger import goes on in the background while the page shows what is ready. `docker stop` gives the server 30 seconds to finish. If an import is cut off, the next view of the album continues it.

## Tests

End-to-end tests use Playwright and run on every push in GitHub Actions. To run them locally you need a PostgreSQL role that can create databases. The tests create and reset a separate database called `galleria_e2e`; set `E2E_PGDATABASE` to use another one.

```sh
npx playwright install chromium
npm run test:e2e
```
