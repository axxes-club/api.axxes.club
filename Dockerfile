# api.axxes.club on Cloud Run: runs api/index.ts (the handler production uses on Vercel).
FROM node:24-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY . .
RUN npm ci && rm -f .env .env.* && chown -R node:node /app
ENV NODE_ENV=production PORT=8080
USER node
EXPOSE 8080
CMD ["sh", "-c", "if [ -f /secrets/env ]; then exec node --env-file=/secrets/env --import tsx gcp/server.ts; else exec node --import tsx gcp/server.ts; fi"]
