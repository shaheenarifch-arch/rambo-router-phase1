# RAMBO Router: Phase 1

Routing And Model Balancing Orchestrator. This starter provides a TypeScript monorepo, unified request validation, provider abstraction, static model registry, weighted routing, authenticated Fastify API, Prisma schema, Docker development environment, and tests.

## Run locally

```bash
cp .env.example .env
docker compose up -d postgres
corepack enable
pnpm install
pnpm db:generate
pnpm db:migrate --name init
pnpm dev
```

Test the gateway:

```bash
curl -s http://localhost:8080/health
curl -s -X POST http://localhost:8080/v1/responses \
  -H 'content-type: application/json' \
  -H 'x-api-key: replace-with-a-long-random-key' \
  -d '{"applicationId":"chambelli","mode":"smart","taskType":"architecture","messages":[{"role":"user","content":"Design a product-sync worker"}]}'
```

## Phase 1 boundaries

- Uses a `MockProvider` so the project runs without paid credentials.
- The model registry is static starter data.
- Prisma models establish persistence, but API persistence is intentionally the next implementation unit.
- Streaming, real provider SDKs, fallback/circuit breakers, budgets, and Executive Mode belong to later phases.

## Next implementation order

1. Add repository services using Prisma.
2. Add OpenAI and Anthropic adapters behind the common interface.
3. Hash and rotate application API keys instead of one environment key.
4. Persist requests and attempts.
5. Add provider health checks and controlled fallback.

<!-- redeploy: BLACK executive showcase (PR #5) -->
