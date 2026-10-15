# AskBy Studio — web app + background worker in one image (FFmpeg included)
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# dependencies (postinstall generates the Prisma client and copies the fonts)
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY scripts ./scripts
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
# migrations + idempotent seed (admin account, theme presets, demo project), then web + worker
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx prisma/seed.ts && npm start"]
