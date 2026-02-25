# Context Fabric — cross-platform MCP server
#
# Uses node:sqlite (built-in since Node.js 22.5) — zero native dependencies,
# builds identically on Linux, macOS, and Windows via Docker.
#
# Cross-platform stdio bridge — works with any MCP client:
#   docker build -t context-fabric .
#   docker run --rm -i -v context-fabric-data:/data/.context-fabric context-fabric
#
# The MCP client spawns that command as its subprocess; Docker forwards
# stdin/stdout transparently. No ports, no code changes, no native compilation.

# ============================================================================
# Stage 1: Build (TypeScript → JS)
# ============================================================================
FROM node:22-slim AS builder

WORKDIR /app

# No build tools needed — zero native dependencies
COPY package.json ./
RUN npm install

COPY src ./src
COPY tsconfig.json ./
RUN npm run build

# ============================================================================
# Stage 2: Production
# ============================================================================
FROM node:22-slim AS production

WORKDIR /app

# --- Data directory ---
# HOME=/data makes os.homedir() return /data inside the container, so the
# config, SQLite DB, and L3 index all land in /data/.context-fabric —
# the path that gets volume-mounted for cross-session persistence.
ENV HOME=/data
RUN mkdir -p /data/.context-fabric

# --- Embedded ONNX model ---
# Copied from local_cache/ so the container never downloads at runtime.
# FASTEMBED_CACHE_PATH tells the embedding service where to look.
COPY local_cache /app/models
ENV FASTEMBED_CACHE_PATH=/app/models

# --- Production dependencies (pure JS, no native modules) ---
COPY --from=builder /app/package.json ./
RUN npm install --omit=dev

# --- Built server ---
COPY --from=builder /app/dist ./dist

# --- Non-root user ---
RUN groupadd -r cf && useradd -r -g cf cf \
    && chown -R cf:cf /app /data

USER cf

# Persist memories across container restarts / --rm runs
VOLUME ["/data/.context-fabric"]

# stdio MCP transport — no network ports needed
CMD ["node", "dist/server.js"]
