# --- Build stage: install all deps and produce the client + server bundle ---
FROM node:22-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- Runtime stage: only production deps + the built output ---
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=7860

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 7860
CMD ["npm", "start"]
