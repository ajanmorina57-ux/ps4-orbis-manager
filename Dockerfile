FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci

COPY apps/server apps/server
COPY apps/web apps/web
COPY packages/contracts packages/contracts
COPY scripts scripts
RUN npm run build --workspace @orbis/web

FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=8080
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci --omit=dev --workspace @orbis/server --workspace @orbis/contracts \
  && npm cache clean --force

COPY --from=build --chown=node:node /app/apps/server/src ./apps/server/src
COPY --from=build --chown=node:node /app/packages/contracts/src ./packages/contracts/src
USER node
EXPOSE 8080
CMD ["npm", "run", "start", "--workspace", "@orbis/server"]
