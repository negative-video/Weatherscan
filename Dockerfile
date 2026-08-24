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
COPY --chown=weatherscan:nodejs scripts ./scripts
COPY --chown=weatherscan:nodejs server ./server
COPY --chown=weatherscan:nodejs webroot ./webroot

# Cut the animated condition-icon sheets into one small file per icon.
#
# The sheets are 4864x125 thirty-frame APNGs, and a CSS background-image
# animates for as long as anything paints it — so every slide was costing the
# browser roughly 65 MB/s of PNG decode just to keep the sidebar icon moving.
# Split, a browser only animates the icons a slide actually shows.
#
# Generated here rather than committed: it is a minute of CPU and 50 MB of
# derived files. The server detects whether they exist and the frontend falls
# back to the sheets if they do not.
RUN node scripts/split-icon-sprites.js && \
    chown -R weatherscan:nodejs webroot/images/icons

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
