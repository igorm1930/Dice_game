# syntax=docker/dockerfile:1.7
#
# The web image.
#
# Built from the repository root, for the same reason the API image is: a pnpm
# workspace resolves `@dice-game/contracts` through the root lockfile, so a
# context rooted at the app cannot install.
#
#   docker build -f apps/web/Dockerfile -t dice-game-web .
#
# No compiler here. The client has no native dependency, so unlike the API image
# this one needs nothing from apk.

ARG NODE_VERSION=22.13.1
ARG ALPINE_VERSION=3.21

# ---------------------------------------------------------------------------
# 1. Base — pnpm at the version package.json pins
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS base

WORKDIR /repo

# Not corepack. See the long comment in apps/api/Dockerfile: the corepack shipped
# with Node images trusts an npm signing key that expired on 2025-01-29, so it
# cannot verify the current pnpm tarball and the build dies with "Cannot find
# matching keyid" wherever it runs.
COPY package.json ./
RUN npm install -g "pnpm@$(node -p "require('./package.json').packageManager.split('@')[1]")"

# ---------------------------------------------------------------------------
# 2. Install and build
# ---------------------------------------------------------------------------
FROM base AS build

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/typescript-config/package.json packages/typescript-config/
COPY apps/web/package.json apps/web/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile

COPY packages/ packages/
COPY apps/web/ apps/web/

# Where the browser sends its requests, and it is baked in here rather than read
# at runtime: Next inlines `NEXT_PUBLIC_*` into the client bundle at build time,
# so setting it in `docker run` would change nothing.
#
# The default is deliberately **empty**, which makes every request relative —
# `fetch('/api/games')` rather than `fetch('https://somewhere/api/games')`. That
# is what lets one image serve any domain: the reverse proxy in front puts the
# API and the client on a single origin, so there is nothing to configure per
# deployment and no CORS to arrange. Set it only when the API is genuinely on
# another origin.
ARG NEXT_PUBLIC_API_URL=""
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

RUN pnpm --filter @dice-game/contracts run build && \
    pnpm --filter @dice-game/web run build

# ---------------------------------------------------------------------------
# 3. Runtime
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

WORKDIR /app

# The three pieces `output: 'standalone'` splits a build into. `static` and
# `public` are deliberately *not* part of the standalone bundle — Next expects
# them to be served from disk or a CDN, and an image that copies only the
# bundle starts cleanly and then serves a page with no CSS.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static

ARG APP_VERSION=0.0.0
ARG GIT_SHA=unknown
ARG BUILD_DATE=unknown

LABEL org.opencontainers.image.title="dice-game-web" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.source="https://github.com/igorm1930/dice_game"

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# The standalone server, at the path the workspace layout puts it.
CMD ["node", "apps/web/server.js"]
