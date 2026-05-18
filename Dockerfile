# Stage 1 : dépendances
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
# Stage 2 : production
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
#Securité
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
RUN apk add --no-cache curl

COPY --from=deps --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --chown=appuser:appgroup . .
USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s CMD curl -f "http://localhost:${PORT}/health" || exit 1
CMD [ "npm" , "run" ,"start" ]