# NanoClaw Teams Sidecar
# Bot Framework SDK HTTP server for MS Teams integration

FROM node:22-slim

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Create data directory for conversation reference persistence
RUN mkdir -p /data

EXPOSE 3978

CMD ["node", "dist/index.js"]
