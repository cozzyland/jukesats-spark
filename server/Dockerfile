FROM node:22-slim

# Install gosu for privilege de-escalation
RUN apt-get update && apt-get install -y --no-install-recommends gosu && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev for build)
RUN npm ci

# Copy source and static files
COPY tsconfig.json ./
COPY src ./src
COPY public ./public

# Build TypeScript
RUN npm run build

# Remove dev dependencies for smaller image
RUN npm prune --production

# Create data directory for wallet and database storage
RUN mkdir -p /data/hot-wallet && chown -R node:node /data

# Copy entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Expose port
EXPOSE 3001

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dist/bootstrap.js"]
