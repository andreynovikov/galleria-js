## Introduction

Galleria is a responsive and mobile friendly web application designed for presentation and management of self-hosted photo archive. The main ideas behind it are:

1. No administrative interface, everything is managed via image files (backed by database for responsiveness)
2. Photos are grouped in bundles (galleries)
3. Photos can be filtered by many criteria (tags, authors, shooting dates), also across bundles
4. Each bundle can contain hundreds of photos
5. Friendly URLs for easy blogging
6. Anonymous access can be restricted

## Examples

* [Entrance page with selection by label](https://andreynovikov.info/photos)
* [Huge bundle with hundreds of photos](https://andreynovikov.info/photos/travel/Georgia/2015)
* [Bundle filtered by shooting time](https://andreynovikov.info/photos/travel/Georgia/2015?-filt.from=2015-06-25&-filt.till=2015-06-26)
* [All photos filtered by label](https://andreynovikov.info/photos/?-filt.labels=10&-filt.notlabels=13)
* [Photos filtered by named labes](https://andreynovikov.info/photos?-filt.labels=Омало,Таня)
* [Single photo, original image file, huge](https://andreynovikov.info/photos/travel/Georgia/2015/IMG_2171.JPG?format=original)
* [Single photo, optimized](https://andreynovikov.info/photos/travel/Georgia/2015/IMG_2171.JPG)
* [Single thumbnail](https://andreynovikov.info/photos/travel/Georgia/2015/IMG_2171.JPG?format=thumbnail)

Last two examples are useful for blogging – photos can be inserted in text as if they are static.

## Requirements

* Node.js
* PostgreSQL
