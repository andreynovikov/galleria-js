FROM node:24-alpine AS base

FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json* ./

ENV NPM_CONFIG_UPDATE_NOTIFIER=false
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# .env.local is not in the build context (see .dockerignore). It is mounted as a secret for the build only, because
# Next loads it and modules such as Better Auth read it while pages are collected, so it is not stored in any layer.
# The container gets it at runtime with `env_file` (see docker-compose.yaml).
RUN --mount=type=secret,id=env_local,target=/app/.env.local npm run build

FROM base AS runner
WORKDIR /app

ARG entity=galleria

ENV NODE_ENV=production

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/startup.sh ./
RUN mv ./server.js ./${entity}.js

USER node

EXPOSE 3000

ENV PORT=3000
ENV APP_MAIN_FILE=${entity}.js

CMD /bin/sh startup.sh ${APP_MAIN_FILE}
