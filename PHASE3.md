# RAMBO Phase 3: Intelligence and resilience

Included:
1. OpenAI adapter
2. Anthropic Claude adapter
3. Google Gemini adapter
4. Dynamic model registry with TTL cache
5. Deterministic task classifier
6. Ordered fallback engine
7. Provider circuit breakers
8. Executive Mode parallel execution, disagreement detection, and transparent synthesis

The provider adapters use native `fetch`, so no provider SDK is required. Model names, pricing, and capability settings remain data-driven and must be configured from provider documentation before production use.

## Validate
```bash
corepack enable
pnpm install
pnpm db:generate
pnpm db:validate
pnpm typecheck
pnpm test
pnpm build
```

## Security
Keep provider keys only in environment variables or a secrets manager. Never commit `.env`. Executive Mode has to enforce application budgets before production rollout.
