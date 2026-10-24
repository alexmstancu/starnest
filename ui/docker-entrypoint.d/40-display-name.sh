#!/bin/sh
# Writes the served config.json from APP_DISPLAY_NAME each time the container starts (PL-023).
#
# The official nginx image runs every executable /docker-entrypoint.d/*.sh before nginx, so
# renaming the product in .env and restarting the container renames the interface with no
# rebuild. Empty or absent, the config.json baked in at build time (ui/public/config.json)
# stands -- which is also what the Vite dev server and `make e2e` read, outside Docker.
set -eu

target="${CONFIG_JSON_PATH:-/usr/share/nginx/html/config.json}"
name="${APP_DISPLAY_NAME:-}"

if [ -z "$name" ]; then
  exit 0
fi

# JSON-escaped: backslash first, then the double quote; control characters dropped, because a
# display name has none and one would break the string.
escaped=$(printf '%s' "$name" | tr -d '\000-\037' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')

printf '{\n  "display_name": "%s"\n}\n' "$escaped" > "$target"
