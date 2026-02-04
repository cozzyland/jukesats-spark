FROM node:22-slim

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

# Create data directory for wallet storage
RUN mkdir -p ./data/hot-wallet

# Expose port
EXPOSE 3001

# Run the server (bootstrap.js applies polyfills then loads main.js)
CMD ["node", "dist/bootstrap.js"]
