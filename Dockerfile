FROM node:21.7.1-alpine AS base

FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json* ./

RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

FROM base AS runner
WORKDIR /app

ARG entity=galleria

ENV NODE_ENV production

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/.env.local ./
COPY --from=builder --chown=node:node /app/next.config.mjs ./
COPY --from=builder --chown=node:node /app/startup.sh ./
RUN mv ./server.js ./${entity}.js

USER node

EXPOSE 3000

ENV PORT 3000
ENV APP_MAIN_FILE ${entity}.js

CMD /bin/sh startup.sh ${APP_MAIN_FILE}
