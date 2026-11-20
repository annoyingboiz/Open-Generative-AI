FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a
WORKDIR /app
ENV NODE_ENV=production
# ffmpeg: the first frame of a video for grid previews.
RUN apk add --no-cache ffmpeg
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
COPY assets ./assets
RUN mkdir -p /data && chown node:node /data
USER node
ENV DATA_DIR=/data HOST=0.0.0.0 PORT=3300
EXPOSE 3300
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:${PORT}/healthz || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
