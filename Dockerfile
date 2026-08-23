# Weatherscan IntelliStar Simulator
#
# Single stage, no build step, no npm install: the server has zero runtime
# dependencies. That keeps the image small and the advisory surface empty.

FROM node:22-alpine

RUN apk add --no-cache tini wget

WORKDIR /app

# Non-root from the start.
RUN addgroup -g 1001 -S nodejs && \
    adduser -S weatherscan -u 1001 -G nodejs

COPY --chown=weatherscan:nodejs package.json ./
COPY --chown=weatherscan:nodejs server ./server
COPY --chown=weatherscan:nodejs webroot ./webroot

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

EXPOSE 8080

USER weatherscan

# tini reaps zombies and forwards signals, so `docker stop` exits cleanly.
ENTRYPOINT ["/sbin/tini", "--"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://127.0.0.1:8080/api/healthz || exit 1

CMD ["node", "server/index.js"]
