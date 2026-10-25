# RAMBO Phase 2 database and repository layer

Adds a normalized Prisma schema, repository package, API-key service, usage records, provider health history, database model registry, request/attempt persistence, and indexes for operational queries.

## Install and validate

```bash
corepack enable
pnpm install
cp .env.example .env
docker compose up -d postgres
pnpm db:generate
pnpm db:validate
pnpm db:migrate --name phase2_persistence
pnpm typecheck
pnpm test
pnpm build
```

Do not upload this project through GitHub's flat multi-file uploader. Preserve folders using Git, GitHub Desktop, or VS Code Source Control.
