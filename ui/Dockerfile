# The interface container.
#
# A separate client that shares no code with the backend (arch.md 6.1) -- which is why it has
# its own Dockerfile, its own toolchain, and its own build. It reaches the backend over HTTP
# and nothing else.
#
# The result is static files. React is not "running" in production; nginx is.

FROM node:24-alpine AS build

WORKDIR /app

# Manifest first, so a source edit does not reinstall node_modules.
COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build


FROM nginx:1.27-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

# The image runs every executable /docker-entrypoint.d/*.sh before nginx starts. This one writes
# config.json from APP_DISPLAY_NAME (compose.yaml), so the product's name is the one in .env and
# not the one baked in above; a container started without the variable keeps the baked file.
COPY --chmod=0755 docker-entrypoint.d/40-display-name.sh /docker-entrypoint.d/40-display-name.sh

EXPOSE 80

# No API base URL is baked into the image, deliberately. nginx proxies /v1 to the backend,
# so the client uses a relative path and the browser makes same-origin requests. Two things
# fall out of that: no CORS configuration anywhere, and the image is not rebuilt when the
# backend moves.
