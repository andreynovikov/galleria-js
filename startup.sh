#!/bin/sh
set -e

find ./.docker/ -mindepth 1 -delete
cp -a ./.next/static ./.docker/
# exec: node becomes PID 1 and gets SIGTERM from `docker stop`, so it shuts down gracefully and finishes
# background work (pending `after()` callbacks such as album sync and view logging)
exec node "$1"
