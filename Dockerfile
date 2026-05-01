FROM node:24-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM python:3.14.7-slim-bookworm@sha256:9ab8d9c8514b44f90cf0029dd42fdd7e9e211e639c8b995304cc04568dee900f
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 ca-certificates && rm -rf /var/lib/apt/lists/* && groupadd --gid 10001 app && useradd --uid 10001 --gid app --no-create-home app
COPY --from=build /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=build --chown=10001:10001 /app /app
RUN mkdir -p /app/.data && chown -R 10001:10001 /app/.data
USER 10001:10001
ENV DEBUGROOM_SERVE_STATIC=1 DEBUGROOM_HOST=0.0.0.0 PORT=3001
EXPOSE 3001
CMD ["node", "--import", "tsx", "apps/api/src/server.ts"]
