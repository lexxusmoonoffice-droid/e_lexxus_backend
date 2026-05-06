# --- deps stage -----------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app
# libvips for `sharp`; openssl for bcrypt bindings on musl.
RUN apk add --no-cache vips-dev python3 make g++ libc6-compat
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- build stage (no TypeScript, but keeps the three-stage pattern) -
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Smoke: make sure everything loads at build time.
RUN node -e "require('./src/app')"

# --- runtime stage --------------------------------------------------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Minimal runtime libs for sharp
RUN apk add --no-cache vips tini

# Non-root user
RUN addgroup -S lexx && adduser -S lexx -G lexx

COPY --from=build --chown=lexx:lexx /app/node_modules ./node_modules
COPY --from=build --chown=lexx:lexx /app/package.json ./package.json
COPY --from=build --chown=lexx:lexx /app/src ./src
COPY --from=build --chown=lexx:lexx /app/scripts ./scripts
COPY --from=build --chown=lexx:lexx /app/src/templates ./src/templates

USER lexx

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-5000}/api/health || exit 1

# tini is PID 1 so SIGTERM reaches the Node process cleanly (matters
# for our graceful-shutdown path in src/server.js).
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
