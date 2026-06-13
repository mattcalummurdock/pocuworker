# POCU jobs worker — Cloud Run (poll Supabase + run on-chain training via Hardhat).
# Build:  docker build -f Dockerfile.worker -t pocu-worker .
# Run:    docker run --rm --env-file .env -e DEPLOYMENT_JSON="$(cat deployments/testnet.json)" -p 8080:8080 pocu-worker
#
# Cloud Run: use --min-instances 1 --timeout 3600 --memory 4Gi --cpu 2
# Set DEPLOYMENT_JSON to the contents of deployments/testnet.json (or use Secret Manager).
# Set AGENT_SERVICE_URL to your deployed agent URL (NFT mint).
# Agent + worker must share /app/data and /app/output (e.g. same GCS volume mount).

FROM node:20-bookworm-slim

ENV PORT=8080 \
    JOB_WORKER_POLL_MS=15000

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates python3 build-essential \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
# Hardhat is a devDependency — must install dev deps (NODE_ENV=production skips them).
RUN npm ci --include=dev

COPY hardhat.config.ts tsconfig.json ./
COPY contracts ./contracts
COPY scripts/train.ts ./scripts/train.ts
COPY scripts/preprocess-tabular.ts ./scripts/preprocess-tabular.ts
COPY src ./src

RUN npm run compile && mkdir -p data output deployments

EXPOSE 8080

CMD ["sh", "-c", "echo \"[pocu-worker] container start $(date -u +%Y-%m-%dT%H:%M:%SZ)\" && mkdir -p deployments data output && if [ -n \"$DEPLOYMENT_JSON\" ]; then printf '%s' \"$DEPLOYMENT_JSON\" > deployments/testnet.json; fi && exec npm run jobs:worker"]
