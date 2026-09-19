# ==========================================
# Scanny - Multi-Stage Dockerfile
# Basis: node:22-bookworm-slim (NICHT Alpine)
# ==========================================

# Stage 1: Builder
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# WICHTIG: COPY package.json ./ (NICHT package*.json! Die package-lock.json kommt von
# macOS und bricht native Rollup-Pakete unter Linux, npm/cli#4828).
COPY package.json ./

# Abhängigkeiten installieren (inklusive build tools falls native Module nötig)
RUN npm install

# Quellcode kopieren und Frontend + Backend bauen
COPY . .
RUN npm run build

# Stage 2: Runner
FROM node:22-bookworm-slim AS runner

WORKDIR /app

# Systempakete für OCR und Bildbearbeitung installieren
RUN apt-get update && apt-get install -y --no-install-recommends \
    ocrmypdf \
    tesseract-ocr-deu \
    tesseract-ocr-eng \
    tesseract-ocr-osd \
    python3 \
    python3-opencv \
    python3-numpy \
    libheif-examples \
    && rm -rf /var/lib/apt/lists/*

# Nur Produktionsabhängigkeiten installieren
COPY package.json ./
RUN npm install --omit=dev

# Gebaute Artefakte aus dem Builder kopieren
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/pipeline ./server/pipeline

# Umgebungsvariablen & Port
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server/dist/index.js"]
