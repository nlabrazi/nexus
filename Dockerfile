# -------------------------------------------------------------
# Stage 1: Builder
# -------------------------------------------------------------
FROM node:24-alpine AS builder

WORKDIR /build

# Copy dependency manifests
COPY package.json package-lock.json ./
RUN npm ci

# Copy sources and build configuration
COPY tsconfig.json esbuild.js ./
COPY src/ ./src/

# Compile production standalone bundle for Nexus Core
RUN node esbuild.js --production

# -------------------------------------------------------------
# Stage 2: Runtime image (ultra-lightweight & non-root)
# -------------------------------------------------------------
FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production \
    NEXUS_CORE_PORT=4040 \
    NEXUS_CORE_HOST=0.0.0.0

# Create persistent state directory with appropriate permissions
RUN mkdir -p /home/node/.nexus && chown -R node:node /home/node

# Use existing non-root user 'node' provided by node:alpine
USER node

# Copy only the compiled bundle and metadata
COPY --chown=node:node --from=builder /build/dist/core.js /app/core.js
COPY --chown=node:node package.json /app/package.json

EXPOSE 4040

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.NEXUS_CORE_PORT || 4040) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["node", "/app/core.js"]
