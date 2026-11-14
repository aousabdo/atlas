# ATLAS as a container image: the built static app and the invented sample
# bundle, served by an unprivileged nginx. Nothing else is in it: no backend,
# no secrets, no volumes. See docs/kubernetes.md.
#
# Build it in CI, from a clean checkout. The build context is an allowlist
# (.dockerignore) that never admits public/data, and the bundle is seeded from
# fixtures/synthetic inside the build, so a real bundle sitting in a
# developer's public/data cannot reach the image. CI then copies the web root
# back out of the finished image and checks it again (technical plan, risk 12).
#
#   docker build --build-arg ATLAS_BUILD_ID="$(git rev-parse HEAD)" -t atlas:dev .
#   docker run --rm --read-only --tmpfs /tmp -p 8080:8080 atlas:dev

# Pinned by digest as well as tag: a tag can be republished, and then the same
# commit builds different bytes and the SBOM describes an image nobody can
# reproduce. The Node major must match .nvmrc; scripts/__tests__/container.test.mjs
# enforces both.
ARG NODE_IMAGE=node:22.23.5-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.30.6-alpine3.24@sha256:f5116ed4606f3eb015dd4a8e28cb9b351476dc0ad4bc6e9f93b19cec130cdf03

# ---------------------------------------------------------------------------
# Build: runs on the builder's own platform. Its output is static files, the
# same for every target architecture, so a multi-arch build compiles once and
# never runs npm under emulation.
# ---------------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS build
WORKDIR /src

# Dependencies first, so a source-only change reuses this layer. The SheetJS
# tarball comes from cdn.sheetjs.com, so the build needs that host once; the
# built app fetches nothing (docs/dependency-decisions.md).
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# The commit this image is built from, stamped into the document head the same
# way the Pages build stamps it, so a running pod can be traced to one commit.
ARG ATLAS_BUILD_ID
ARG ATLAS_BUILT_AT

# `npm run build:dist` is `npm run build` without its first step, the
# repository data guard, which reads `git ls-files` and has no .git here. That
# guard runs on the tree in CI's data job; this image gets the stricter check
# below on what it actually carries.
RUN [ -n "${ATLAS_BUILD_ID:-}" ] || unset ATLAS_BUILD_ID; \
    [ -n "${ATLAS_BUILT_AT:-}" ] || unset ATLAS_BUILT_AT; \
    node scripts/seed-data.mjs \
 && npm run build:dist \
 && rm -f dist/CNAME dist/data/.gitkeep \
 && node scripts/check-image-data.mjs dist

# ---------------------------------------------------------------------------
# Runtime: nginx as uid 101, on 8080, with a read-only root filesystem.
# ---------------------------------------------------------------------------
FROM ${NGINX_IMAGE}

ARG ATLAS_BUILD_ID
ARG ATLAS_BUILT_AT
LABEL org.opencontainers.image.title="atlas" \
      org.opencontainers.image.description="ATLAS static web app with the invented sample bundle only" \
      org.opencontainers.image.revision="${ATLAS_BUILD_ID}" \
      org.opencontainers.image.created="${ATLAS_BUILT_AT}"

# The base image's stock site, default server and entrypoint scripts all go:
# the scripts rewrite config at start-up, which a read-only root filesystem
# refuses, and the stock pages would be served beside the app.
#
# The base also leaves /etc/nginx and /var/cache/nginx owned by the nginx user,
# so that its entrypoint can edit them. Nothing here needs that, and it would
# let the server rewrite its own configuration wherever the root filesystem is
# not read-only (a plain `docker run`). Back to root, and not writable.
USER root
RUN rm -rf /docker-entrypoint.sh /docker-entrypoint.d /etc/nginx/conf.d /usr/share/nginx/html \
 && mkdir -p /usr/share/nginx/html \
 && chown -R root:root /etc/nginx /var/cache/nginx \
 && chmod -R go-w /etc/nginx /var/cache/nginx
COPY deploy/nginx/nginx.conf /etc/nginx/nginx.conf
# Owned by root and only readable by nginx: the server cannot rewrite the
# files it serves.
COPY --from=build /src/dist /usr/share/nginx/html
RUN nginx -t

USER 101:101
EXPOSE 8080
STOPSIGNAL SIGQUIT
ENTRYPOINT ["nginx", "-g", "daemon off;"]
