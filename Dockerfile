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
# onnxruntime-node (background blur): CPU only — skip the CUDA download and drop other platforms' binaries
ENV ONNXRUNTIME_NODE_INSTALL=skip
RUN npm ci \
 && cd node_modules/onnxruntime-node/bin/napi-v6 \
 && find . -mindepth 1 -maxdepth 1 ! -name linux -exec rm -rf {} + \
 && find linux -mindepth 1 -maxdepth 1 ! -name "$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')" -exec rm -rf {} + \
 && rm -f linux/*/libonnxruntime_providers_cuda.so linux/*/libonnxruntime_providers_tensorrt.so

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
# migrations + idempotent seed (admin account, theme presets, demo project), then web + worker
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx prisma/seed.ts && npm start"]
