# ===== Multi-stage Dockerfile for Live Chat System =====
# Stage 1: Build the React frontend
# Stage 2: Install backend deps and run the server (serves frontend too)

# ---------- Stage 1: Build frontend ----------
FROM node:20-slim AS frontend-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install --no-audit --no-fund
COPY client/ ./
RUN npm run build

# ---------- Stage 2: Backend + serve frontend ----------
FROM node:20-slim AS production
WORKDIR /app

# Install backend deps
COPY server/package*.json ./server/
RUN cd server && npm install --no-audit --no-fund --omit=dev

# Copy backend source
COPY server/ ./server/

# Copy built frontend into server/public
RUN mkdir -p server/public
COPY --from=frontend-build /app/client/dist/ ./server/public/

# Create data directory for JSON DB
RUN mkdir -p server/data

ENV NODE_ENV=production
ENV PORT=5000
ENV DB_PATH=./data/chat.json

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||5000)+'/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

WORKDIR /app/server
CMD ["node", "src/index.js"]
