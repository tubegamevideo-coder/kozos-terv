# --- build ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# --- futtatás ---
FROM node:22-alpine
WORKDIR /app
# git + ssh: a repóból hivatkozott szakaszok SSH-kulccsal (deploy key) is olvashatók.
# /data: a kulcsok és a git-gyorsítótár helye (kötet a docker-compose.yml-ben).
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 REPO_STATE_DIR=/data
RUN apk add --no-cache git openssh-client \
	&& addgroup -S app && adduser -S app -G app \
	&& mkdir -p /data && chown app:app /data && chmod 700 /data
COPY --from=build --chown=app:app /app/package.json ./
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/build ./build
COPY --from=build --chown=app:app /app/drizzle ./drizzle
COPY --from=build --chown=app:app /app/scripts ./scripts
COPY --from=build --chown=app:app /app/src/lib/server ./src/lib/server
COPY --from=build --chown=app:app /app/docs ./docs
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
# Indításkor migrál, utána indul a szerver.
CMD ["sh", "-c", "node --import tsx scripts/migrate.ts && node build"]
