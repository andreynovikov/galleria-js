[![CI](https://github.com/andreynovikov/galleria-js/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/andreynovikov/galleria-js/actions/workflows/ci.yml)

# Galleria

Galleria is a web gallery for your own photo archive, on your own server. Point it at a folder of photos, and it shows each subfolder as an album, with the captions, keywords and dates you have already written into the photos. There is no admin panel and no uploading: you organize the photos with your usual tools, and the gallery follows the folder by itself.

It works well on phones and computers alike, and handles albums with hundreds of photos.

## Features

**Browsing**
* A landing page with a slideshow of random photos and a list of albums and labels to choose from
* Albums as photo grids that keep each photo's proportions, with thumbnails loaded as you scroll
* A full-screen viewer with zoom, swipe gestures and keyboard navigation, which shows each photo's caption, labels and camera settings (focal length, ISO, shutter speed, aperture)
* Photos turned the right way up by their EXIF orientation

**Finding photos**
* Labels made from the photos' keywords, shown as a label cloud
* Filters by labels (with and without), by shooting date and time, within one album or across the whole archive, combined as you like
* Related labels: after choosing one label, the labels that appear together with it
* Sorting by shooting time, time added or file name, in either direction

**Sharing and blogging**
* Friendly URLs: an album's address is its folder path, and a photo's address is its file path
* Photo URLs that work like static image files, so you can put them straight into a blog post or a forum message: the optimized screen version, a thumbnail or the original file
* Downloads of original files from the viewer, and, for signed-in visitors, of a whole album or filtered selection as one ZIP archive

**Privacy and access**
* Sign-in with GitHub, Google, Yandex, Mail.ru or VK ID, no passwords to keep
* Restricted labels: photos with them are blurred and locked for anonymous visitors, and shown normally to anyone signed in
* Censorship levels: photos you mark are hidden completely, as if they didn't exist, from everyone except the visitors you allow to see them
* A view history for administrators: who looked at which photos, from where and with which device, by day

**Running it**
* Folder sync: new, edited, moved and removed photos are picked up automatically, and half-copied files are never imported
* Optional Google Analytics
* Docker deployment, with a tested nginx configuration example

## Why Galleria

* **Your files stay the source of truth.** The gallery never changes your photos and never asks you to import them. The database only remembers what it has read from the files, so you can rebuild it at any time.
* **No admin interface to learn.** Captions and keywords come from the photo files, which you can edit in Lightroom, digiKam, XnView, exiftool or most other photo tools. Albums are folders.
* **Made for large archives.** Albums of hundreds of photos open quickly, thumbnails are made once and kept, and resized versions are cached in memory.
* **Photo URLs that last.** A photo's address is its path, so links in old blog posts keep working, and embedded photos still go through the gallery's access rules.
* **Private where it matters.** Restricted and hidden photos are checked on every request, including direct image URLs, so a photo can't leak through a guessed address.
* **Careful about security.** Strict Content Security Policy, rate limits in the nginx example, sign-in through well-known providers only, and secrets kept out of the Docker image.
* **Tested.** An end-to-end test suite runs in a real browser on every change, on desktop and mobile, including the nginx example from this README.

## Examples

* [Entrance page with selection by label](https://newf.ru/photos)
* [Huge bundle with hundreds of photos](https://newf.ru/photos/travel/Georgia/2015)
* [Bundle filtered by shooting time](https://newf.ru/photos/travel/Georgia/2015?-filt.from=2015-06-25&-filt.till=2015-06-26)
* [All photos filtered by label](https://newf.ru/photos/?-filt.labels=10&-filt.notlabels=13)
* [Photos filtered by named labels](https://newf.ru/photos?-filt.labels=Омало,Таня)
* [Single photo, original image file, huge](https://newf.ru/photos/travel/Georgia/2015/IMG_2171.JPG?format=original)
* [Single photo, optimized](https://newf.ru/photos/travel/Georgia/2015/IMG_2171.JPG)
* [Single thumbnail](https://newf.ru/photos/travel/Georgia/2015/IMG_2171.JPG?format=thumbnail)

The last two examples are useful for blogging: you can put photos in a text as if they were static images.

## Preparing your photos

**Albums are folders.** Every folder with `.jpg` files inside your photos folder is an album, at the same path in the URL. For example, `travel/Georgia/2015/IMG_2171.JPG` becomes `https://example.com/photos/travel/Georgia/2015` (the album) and `https://example.com/photos/travel/Georgia/2015/IMG_2171.JPG` (the photo). Folders can be nested as deep as you like; folders whose names start with a dot are ignored. Only JPEG files with the `.jpg` extension (in any case) are shown.

**Metadata comes from the files.** Galleria reads the information most photo tools write:

| What | Where it is read from |
|---|---|
| Caption | IPTC caption, or else the headline, or else the object name (title) |
| Labels | IPTC keywords |
| Shooting time | EXIF date and time |
| Camera settings | EXIF focal length, ISO, exposure time, aperture |
| Orientation | EXIF orientation |

**Changes are picked up by themselves:**
* **New folders** appear on the entrance page within `SYNC_INTERVAL_MINUTES` (10 by default), when the gallery scans the whole photos folder; it also scans at start. Opening an album's URL imports it at once.
* **Added, removed and edited photos** are picked up the same way, or when someone opens the album. An edited photo (a new caption or keywords, or a replaced file) is recognized by its size and modification time; its metadata is read again and its thumbnails are made again.
* **Files being copied** are left alone until they haven't changed for a minute, so a half-copied photo is never imported.
* **A removed folder** has its photos removed from the database at the next scan. If the scan finds no albums at all (the photos disk isn't mounted, say), it removes nothing.

A first import of a large album takes a while. The page waits up to 2 seconds for it, then shows what is ready while the rest is imported in the background. If the import is cut off (the gallery is restarted, say), the next view of the album continues it.

Thumbnails are kept in a `thumbs` folder inside each album folder, so the gallery needs write access there.

## Installation

Galleria runs in Docker on the same server as PostgreSQL and the photo archive, behind a web server (such as nginx) that handles HTTPS.

### Requirements

* Docker with Compose v2 and BuildKit (the default in current Docker releases)
* PostgreSQL
* Node.js with npm, to run the build scripts (or run the `docker compose` commands they contain yourself)
* A web server for HTTPS, such as nginx
* An OAuth app with at least one of GitHub, Google, Yandex, Mail.ru or VK, if visitors are to sign in (the sign-in page lists all five, but only the ones you configure work)

Get the code:

```sh
git clone https://github.com/andreynovikov/galleria-js.git
cd galleria-js
```

### 1. Prepare the server

* **Database.** Create a PostgreSQL database and apply the schema: `psql -d galleria -f sql/schema.sql`. The container connects through the host's socket, mounted at `/var/run/postgresql`.
  * The container runs as the `node` user (uid 1000).
  * With `peer` authentication, PostgreSQL sees the container as the host user with uid 1000, so that user needs a database role.
  * Alternatively, use password authentication and set `PGUSER` and `PGPASSWORD`.
* **Photos.** The archive is mounted from `/photos` (change the volume in [docker-compose.yaml](docker-compose.yaml) if it lives elsewhere). Uid 1000 needs write access to the album folders, because thumbnails are written to a `thumbs/` subfolder in each of them.

### 2. Configure

Settings come from two files:
* `.env`: non-secret defaults that come with the code, such as image sizes. See [Settings](#settings) for what you may want to change.
* `.env.local`: your own settings and secrets. Create it next to `docker-compose.yaml`; it is never committed and never copied into the image. A setting in `.env.local` overrides the same one in `.env`.

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

# Administrators as provider:id pairs, see Administration
ADMIN_ID=github:12345
# Photos with these labels (names or ids) are blurred for anonymous visitors
RESTRICTED_LABELS=Private
# Optional
GOOGLE_ANALYTICS_ID=…
GOOGLE_ANALYTICS_API_SECRET=…
```

Register `<BETTER_AUTH_URL><BASE_PATH>/api/auth/callback/<provider>` as the callback URL in each OAuth app (for example `https://example.com/photos/api/auth/callback/github`).

Over HTTPS, the session cookies get the `__Secure-` prefix. If you serve the gallery over plain HTTP, set `BETTER_AUTH_URL` to its `http://` address, or signing in won't work.

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

Replace `/path/to/galleria-js` with the folder you cloned the code into. The rates allow fast scrolling and flipping through the lightbox from one address; raise them if many visitors share one (an office or a mobile carrier NAT). Rejected requests get 429.

### 5. Finish the setup

Once the gallery opens in a browser:
1. Sign in, and check that your albums appear on the entrance page (a large archive takes a while to scan the first time).
2. Make yourself an administrator: sign in once, find your account in the `visitor` table (`psql -d galleria -c 'SELECT provider, id, data FROM visitor'`), add it to `ADMIN_ID` as `provider:id`, and run `npm run docker-deploy`.
3. After a few days, switch the Content Security Policy to `enforce`, as described in [Settings](#settings).

### Updating

```sh
git pull
npm run docker-build
npm run docker-deploy
```

`docker stop` gives the gallery 30 seconds to finish what it is doing, so updating doesn't break an import in progress.

## Administration

Administrators are listed in `ADMIN_ID` as comma-separated `provider:id` pairs (for example `ADMIN_ID=github:12345,vk:67890`). They can:
* open **`/history`**, the view history: visitors, their addresses and devices, and the photos they viewed, downloaded and zoomed into, a week at a time. Administrators' own views are not recorded.
* add **`?updatemetadata=1`** to an album URL to read the metadata (dimensions, captions, keywords, shooting time) of every photo in it again. Normally not needed: edited photos are picked up by themselves.
* add **`?format=thumbnail&force=1`** to a photo URL to make its thumbnail again.

For other visitors these parameters are ignored.

**Restricted photos.** Give photos a keyword listed in `RESTRICTED_LABELS` (for example `Private`). Anonymous visitors still see them, blurred with a lock, and can't open the originals; anyone signed in sees them normally.

**Hidden photos.** For photos that only some visitors may see, use censorship levels, which are set in the database. A photo with a `censored` level above a visitor's `censorship` level is hidden from that visitor completely: it isn't listed, its URL answers "not found", and albums and labels that only it has don't show. Everyone starts at level 0, anonymous visitors included.

```sh
# Hide photos: everything in one album, or a single photo
psql -d galleria -c "UPDATE image SET censored = 1 WHERE bundle = '/family/2020'"
psql -d galleria -c "UPDATE image SET censored = 1 WHERE bundle = '/family/2020' AND name = 'IMG_0001.jpg'"
# Allow a visitor (after their first sign-in) to see them
psql -d galleria -c "UPDATE visitor SET censorship = 1 WHERE provider = 'github' AND id = '12345'"
```

A visitor's new level applies the next time they sign in. Photos added to the folder later start at level 0, so set the level for them too.

## Settings

Besides the settings in step 2, these can be put in `.env.local` to change the defaults from `.env`. Run `npm run docker-deploy` after changing them (`BASE_PATH` needs a rebuild).

| Setting | Default | What it does |
|---|---|---|
| `SYNC_INTERVAL_MINUTES` | `10` | How often the whole photos folder is scanned for changes; `0` turns the scan off (albums are still synced when viewed) |
| `SCREEN_MAX_WIDTH` | `1200` | Width of the optimized photo version, in pixels |
| `EXPORT_MAX_WIDTH` | `600` | Width of the `?format=export` version |
| `THUMBNAIL_WIDTH` | `{"s": 150, "m": 300, "l": 450}` | Thumbnail sizes (`?format=thumbnail&size=s`) |
| `SCREEN_CACHE_MB` | `256` | Memory kept for resized photos, in megabytes; `0` turns it off. Leave the container that much memory on top of what Node needs. |
| `DOWNLOAD_MAX_IMAGES` | `1000` | The largest album or selection that can be downloaded as one archive |
| `LOG_RETENTION_DAYS` | `365` | How long the view history is kept; `0` keeps it forever. It is stored by month, and a month is dropped once all of it is older than this. |
| `CLIENT_HINTS` | `Sec-CH-UA-Model` | Extra device information browsers are asked for, see below |
| `CSP_NONCE` | `report` | How strict the Content Security Policy is, see below |

**Content Security Policy.** Pages send a policy that lets only their own scripts run, by a nonce new for every page, so a script injected into a page through some bug is blocked. `CSP_NONCE` sets how strictly: `report` (the default) still allows inline scripts and only reports what the nonce policy would block, `enforce` blocks it. Browsers send the reports to the app, which writes them to its log (`Content Security Policy would block …`, at most once an hour for each kind). After deploying, browse the gallery for a while, signed in and not, with Google Analytics on if you use it; if the log shows no such lines after some days, set `CSP_NONCE=enforce` in `.env.local` and run `npm run docker-deploy`.

**Device information and the EU.** The view history records each visitor's browser, whether it is a mobile device, and which one. Chromium browsers send the browser and the mobile flag with every request, but they hide the device model: Chrome on Android reports every phone as `K`. So pages ask for the model with the `Sec-CH-UA-Model` Client Hint, set in `CLIENT_HINTS` (comma-separated hint names). If your visitors are in the EU, consider setting it empty in `.env.local` (`CLIENT_HINTS=`): asking a browser for information it doesn't send by itself, for logging, may need the visitor's consent under the ePrivacy Directive. The history then shows the browser and the mobile flag, without the model.

## Troubleshooting

* **Signing in doesn't work over plain HTTP.** Set `BETTER_AUTH_URL` to the `http://` address.
* **The provider says the redirect URI is wrong.** Check the callback URL registered in the OAuth app against `<BETTER_AUTH_URL><BASE_PATH>/api/auth/callback/<provider>`. `BETTER_AUTH_URL` is the origin only, without the path.
* **An album is empty or thumbnails are missing.** Check that uid 1000 can read the photos and write to the album folders, and look at the log: `journalctl CONTAINER_NAME=nextjs-galleria`.
* **Photos just copied in don't show.** They are imported once they haven't changed for a minute.
* **Visitors get "429" errors.** Raise the rates in the nginx example, typically for many visitors behind one address.

## For developers

### Running locally

You need Node.js, PostgreSQL with `sql/schema.sql` applied to a database, and a folder of photos. Put the database connection (the standard `PGHOST`, `PGDATABASE`, `PGUSER`, … variables), `PHOTOS_FOLDER` and `AUTH_SECRET` in `.env.local`, then:

```sh
npm install
npm run dev          # development server on port 3000
npm run lint
npm run typecheck
```

[CLAUDE.md](CLAUDE.md) describes the architecture: routing, sync, the database layer, access control, sign-in and logging.

### URL parameters

Galleries accept these query parameters, which the interface sets itself and which can be used in links:

| Parameter | Meaning |
|---|---|
| `-filt.labels` | Photos with all of these labels: ids or names, comma-separated |
| `-filt.notlabels` | Photos with none of these labels |
| `-filt.from`, `-filt.till` | Shooting time from and till, as an ISO date (`2015-06-25`) or date and time |
| `-filt.censored` | Show only photos up to this censorship level (it can't be raised above the visitor's own) |
| `-nav.order` | `stime` (shooting time, the default), `ctime` (time added) or `name`; with `-` in front, in reverse |

Photo URLs take `format` (`original`, `export`, `thumbnail`, or none for the screen version), `size` (a `THUMBNAIL_WIDTH` key), `constraint=vertical` (a thumbnail of fixed height) and `ratio` (a fraction of the screen width, from 0 to 1).

### Tests

End-to-end tests use Playwright and run on every push in GitHub Actions, together with lint and typecheck. To run them locally you need a PostgreSQL role that can create databases. The tests create and reset a separate database called `galleria_e2e`; set `E2E_PGDATABASE` to use another one.

```sh
npx playwright install chromium
npm run test:e2e
```

`npm run test:e2e:nginx` runs the app built with `BASE_PATH=/photos` behind nginx, with a configuration made from the nginx example above, so the example is tested too. It needs nginx installed (`/usr/sbin/nginx`, or set `NGINX`), but not running. When you change the example, keep its three blocks between the "4. Front web server" and "Updating" headings: [e2e/nginx/config.mts](e2e/nginx/config.mts) reads them from there.

`npm run test:e2e:photos` regenerates the test photos in `e2e/fixtures/` (needs `exiftool`).
