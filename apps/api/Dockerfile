# syntax=docker/dockerfile:1.7
#
# The API image.
#
# Built from the repository root, not from apps/api — a pnpm workspace resolves
# `@dice-game/contracts` through the root lockfile, so a context rooted at the
# app cannot install.
#
#   docker build -f apps/api/Dockerfile -t dice-game-api .
#
# The interesting part is stage 3. pnpm's node_modules is a tree of symlinks
# into a content-addressed store, so the usual `COPY --from=deps node_modules`
# produces a directory of broken links. `pnpm deploy` materialises a real,
# self-contained tree for one workspace package instead. The alternative —
# `node-linker=hoisted` in .npmrc — would defeat pnpm's strictness across the
# whole workspace to solve a problem that belongs to one build stage.

ARG NODE_VERSION=22.13.1
ARG ALPINE_VERSION=3.21

# ---------------------------------------------------------------------------
# 1. Base — pnpm at the version package.json pins
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS base

WORKDIR /repo

# Installed with npm rather than through corepack, which cannot do this job.
#
# corepack verifies a package-manager download against a list of npm signing
# keys compiled into it. npm rotated that key, and the old one expired on
# 2025-01-29. Every Node image published before the rotation therefore ships a
# corepack that trusts only the expired key, while the pnpm tarball on the
# registry is signed with the current one — so `corepack enable && pnpm …` dies
# with "Cannot find matching keyid" and there is nothing the build can do about
# it. It is not a network problem and not a cache problem; it fails everywhere,
# offline diagnosis included.
#
# The version is still read from `packageManager` rather than repeated here, so
# there remains exactly one place that decides which pnpm this repository uses.
COPY package.json ./
RUN npm install -g "pnpm@$(node -p "require('./package.json').packageManager.split('@')[1]")"

# ---------------------------------------------------------------------------
# 2. Install and build the workspace
# ---------------------------------------------------------------------------
FROM base AS build

# argon2 is a native addon. It ships prebuilt binaries, but when none matches the
# platform — which is the normal case on Alpine, since musl builds are not
# always published — npm falls back to compiling it with node-gyp, and that
# needs a C toolchain. Without these three packages the install fails deep in a
# gyp trace that names neither argon2 nor the missing compiler as the cause.
#
# This is why the previous generation of this service chose scrypt from
# node:crypto over argon2 (its ADR-0007 says so explicitly): no native module,
# no compiler in the image. Argon2id is the better KDF and worth the build
# dependency — but the cost is real, and it is paid here, in the build stage
# only. The runtime stage copies the compiled .node artefact and carries no
# toolchain.
RUN apk add --no-cache python3 make g++

# Manifests first: these change far less often than source, so the install layer
# survives most rebuilds.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/typescript-config/package.json packages/typescript-config/
COPY apps/api/package.json apps/api/

# --frozen-lockfile: a build that silently resolves a different tree than the
# one committed is not reproducible.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --ignore-scripts=false

COPY packages/ packages/
COPY apps/api/ apps/api/

RUN pnpm --filter @dice-game/contracts run build && \
    pnpm --filter @dice-game/api run build

# `pnpm deploy` writes a real directory tree with production dependencies only.
# No `--legacy`: that flag belongs to pnpm 10, where `deploy` was reworked to
# require `inject-workspace-packages`. This workspace pins pnpm 9.15.4 in
# `packageManager`, which answers `Unknown option: 'legacy'` and fails the build
# on its very last instruction. The comment here used to claim the flag was
# required for the v9 lockfile — exactly backwards.
RUN pnpm --filter @dice-game/api --prod deploy /out

# ---------------------------------------------------------------------------
# 3. Runtime
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS runtime

# No init shim, deliberately.
#
# The usual reason for tini is that PID 1 gets no default signal handlers, so a
# SIGTERM is silently discarded and the ordered drain in main.ts never fires.
# That argument does not apply here: main.ts installs an explicit SIGTERM
# handler, and an installed handler runs at PID 1 like anywhere else. The other
# reason — reaping orphaned children — is moot for a process that spawns none.
#
# Run with an init anyway if the platform offers one for free (`docker run
# --init`; Fly supplies one). The drain is verified either way by the
# smoke test in the deploy workflow, which asserts readiness flips to 503
# before the process stops accepting connections.
ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0

WORKDIR /app

COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/dist ./dist
COPY --from=build --chown=node:node /out/package.json ./package.json

# Build metadata last, so changing a SHA does not invalidate the layers above.
ARG APP_VERSION=0.0.0
ARG GIT_SHA=unknown
ARG BUILD_DATE=unknown
ENV SERVICE_VERSION=${APP_VERSION}

LABEL org.opencontainers.image.title="dice-game-api" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.source="https://github.com/igorm1930/dice_game"

USER node

EXPOSE 3001

# Liveness only. Readiness depends on MongoDB, and a container that restarts
# because its database blinked comes back into the same blinked database.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Exec form: no shell between the platform's SIGTERM and node.
CMD ["node", "dist/main.js"]
