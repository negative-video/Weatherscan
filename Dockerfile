# Multi-stage Dockerfile for Weatherscan IntelliStar Simulator
# Optimized for production use with best practices

# Stage 1: Base image with Node.js
FROM node:18-alpine AS base

# Install dependencies for better reliability
RUN apk add --no-cache \
    dumb-init \
    tini

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Stage 2: Dependencies
FROM base AS dependencies

# Install production dependencies
RUN npm ci --only=production && \
    npm cache clean --force

# Stage 3: Development dependencies (for building if needed)
FROM base AS dev-dependencies

# Install all dependencies including devDependencies
RUN npm ci && \
    npm cache clean --force

# Stage 4: Production image
FROM base AS production

# Set environment variables
ENV NODE_ENV=production \
    PORT=8080 \
    CORS_PORT=8081

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S weatherscan -u 1001

# Copy production dependencies from dependencies stage
COPY --from=dependencies --chown=weatherscan:nodejs /app/node_modules ./node_modules

# Copy application files
COPY --chown=weatherscan:nodejs . .

# Create directory for config if it doesn't exist
RUN mkdir -p /app/config && \
    chown -R weatherscan:nodejs /app

# Expose ports
EXPOSE 8080 8081

# Use tini as init system (handles signals properly)
ENTRYPOINT ["/sbin/tini", "--"]

# Switch to non-root user
USER weatherscan

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:8080/', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
CMD ["npm", "start"]
