# ── Stage 1: build frontend ───────────────────────────────────────────────────
FROM node:22-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: build backend ────────────────────────────────────────────────────
FROM rust:1.90-slim AS backend-build
WORKDIR /app/backend
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
COPY backend/Cargo.toml backend/Cargo.lock ./
# pre-build empty src to cache deps
RUN mkdir src && echo 'fn main(){}' > src/main.rs && cargo build --release && rm -rf src
COPY backend/src/ ./src/
RUN touch src/main.rs && cargo build --release

# ── Stage 3: runtime ─────────────────────────────────────────────────────────
FROM debian:bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=backend-build /app/backend/target/release/backend ./backend
COPY --from=frontend-build /app/frontend/dist ./dist
COPY backend/content.json ./seed/content.json
RUN mkdir -p uploads data

COPY <<'EOF' /app/start.sh
#!/bin/sh
if [ ! -f /app/data/content.json ]; then
  cp /app/seed/content.json /app/data/content.json
  echo "Seeded content.json from seed"
fi
exec /app/backend
EOF
RUN chmod +x /app/start.sh

ENV STATIC_DIR=/app/dist
ENV UPLOADS_DIR=/app/uploads
ENV CONTENT_PATH=/app/data/content.json
ENV PORT=3000

EXPOSE 3000
CMD ["/app/start.sh"]
