# Isolated SingleFile capture service (2_Input_Architecture fallback):
# headless Chromium + SingleFile in a container with no access to the
# application database or secrets. The public app stays on Cloudflare; the
# capture worker (apps/capture, CAPTURE_MODE=container) calls POST /render.
#
# Run with egress restricted to the public internet through a filtering proxy
# (e.g. Stripe Smokescreen) — see README.md in this folder.
FROM node:22-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-liberation ca-certificates dumb-init \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    CHROMIUM_PATH=/usr/bin/chromium \
    PORT=8080

WORKDIR /app
COPY package.json server.mjs ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

# Unprivileged user, no persistent profile or cookies (a fresh temp profile per capture).
RUN useradd --create-home --uid 10001 capture && mkdir -p /tmp/captures && chown capture /tmp/captures
USER capture

EXPOSE 8080
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.mjs"]
