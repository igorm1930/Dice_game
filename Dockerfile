# syntax=docker/dockerfile:1.7

###############################################################################
# Multi-stage build.
#
# The goal is a final image that contains the compiled application, production
# dependencies, and nothing else — no compiler, no test framework, no source.
# Every stage below exists to keep something out of the runtime image.
###############################################################################

ARG NODE_VERSION=22.13.1
ARG ALPINE_VERSION=3.21

###############################################################################
# Stage 1 — deps: production dependencies only.
#
# Resolved from the lockfile in isolation so this layer is cached against
# package.json/package-lock.json alone. Source edits never invalidate it.
###############################################################################
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS deps

WORKDIR /app
COPY package.json package-lock.json ./

# `npm ci` (not `install`) — installs exactly the lockfile, fails if it and
# package.json disagree. A build must never silently resolve a different tree
# than the one that was tested.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --ignore-scripts

###############################################################################
# Stage 2 — build: full toolchain, compiled output.
###############################################################################
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src

RUN npm run build

###############################################################################
# Stage 3 — runtime: the shipped image.
###############################################################################
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS runtime

# Build metadata, injected by CI. Declared here so they do not invalidate the
# dependency layers above.
ARG APP_VERSION=0.0.0
ARG GIT_SHA=unknown
ARG BUILD_DATE=unknown

# OCI annotations make an image self-describing: given only a running container,
# an operator can recover the exact commit it was built from.
LABEL org.opencontainers.image.title="dice-game-service" \
      org.opencontainers.image.description="Production-ready Dice Game backend" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.licenses="MIT"

# tini as PID 1. Node does not reap orphaned children and does not implement
# default signal dispositions for PID 1, so without an init the container can
# ignore SIGTERM entirely and be SIGKILLed after the grace period — which
# defeats the graceful shutdown implemented in server.ts.
RUN apk add --no-cache tini=~0.19

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    LOG_PRETTY=false \
    APP_VERSION=${APP_VERSION} \
    # Keep V8's heap under the container memory limit. Without this, Node sizes
    # its heap from the host's total RAM, ignores the cgroup limit, and gets
    # OOM-killed by the kernel with no diagnostic of its own.
    NODE_OPTIONS="--max-old-space-size=384"

WORKDIR /app

# Ownership is set during COPY rather than with a later `chown -R`, which would
# duplicate the entire tree into a new layer.
COPY --chown=node:node --from=deps  /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist         ./dist
COPY --chown=node:node package.json ./

# Drop privileges. `node` is an unprivileged user provided by the base image;
# running as root would mean a container escape starts with root on the host.
USER node

EXPOSE 3000

# Compose/plain-Docker healthcheck. Kubernetes ignores this and uses the probes
# defined in the manifest, which is why the app exposes both endpoints.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
