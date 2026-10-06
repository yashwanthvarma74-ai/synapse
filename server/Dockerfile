# Synapse server: the REST API and the WebSocket gateway are the same code. SERVICE chooses
# which one(s) a container runs: api, gateway, or both (the default).
ARG NODE_VERSION=26
FROM node:${NODE_VERSION}-slim
WORKDIR /app
ENV NODE_ENV=production
# tsx runs the TypeScript directly, so dev dependencies are installed on purpose
COPY package.json package-lock.json ./
RUN NODE_ENV=development npm ci
COPY tsconfig.json ./
COPY src ./src
USER node
EXPOSE 4000 4001 9464
CMD ["npx", "tsx", "src/index.ts"]
