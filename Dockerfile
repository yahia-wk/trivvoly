# Trivvoly for a hosting provider. Put it behind HTTPS (the provider's proxy) and set PUBLIC_URL.
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production \
    TRUST_PROXY=1 \
    TRIVVOLY_STATE=/data/trivvoly-state.json
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:3000/healthz || exit 1
CMD ["node", "server.js"]
