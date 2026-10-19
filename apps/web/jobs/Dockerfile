# The job runner's image (docs/server-jobs.md, decisions.md 140): Node 24
# and one bundle per server job, built by scripts/build-jobs.mjs before each
# deploy into dist/ beside this file. No npm package is installed here: the
# image never holds the dependency tree beside the service key. The one
# system package is psql, which the v2 import reads people's names with
# (server/v2.ts, V2_DATABASE_URL). The JobRunner
# Durable Object (apps/web/worker/jobs.ts) starts a job by naming its bundle
# as the entrypoint and passes the database URL and key as environment.
FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY dist/ ./
# Node's heap on a standard-1 instance (4 GiB): room for Santhali's fold
# (about 850 MB, decisions.md 103) and for what the cut will add.
ENV NODE_OPTIONS=--max-old-space-size=3072
USER node
CMD ["node", "projections.mjs"]
