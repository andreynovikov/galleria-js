#!/bin/sh
set -e

find ./.docker/ -mindepth 1 -delete
cp -a ./.next/static ./.docker/
node $1
