# SE Power Manager

A private BigCommerce single-click app for solutions engineers: import and manage
demo catalogs, and pull the shared Big Gear demo store (products, Stencil theme,
custom B2B Catalyst channel) into your own store.

Scaffolded from the Power Promotions starter. Read `docs/PLAN.md` for scope and
status, `docs/ARCHITECTURE.md` for the auth and data layers.

## Run locally (demo data, no store needed)

```bash
nvm use            # Node 24
pnpm install
pnpm dev
```

`.env.local` defaults to `DATA_MODE=MOCK`. To try real calls against one store set
`DATA_MODE=STATIC` with `STATIC_STORE_HASH` and `STATIC_STORE_TOKEN`.

## Configuration

See `.env.example`. The parts specific to this app:

| Variable | Purpose |
| --- | --- |
| `BIG_GEAR_STORE_HASH`, `BIG_GEAR_ACCESS_TOKEN` | Read-only token for the shared Big Gear store |
| `BIG_GEAR_B2B_TOKEN` | Only if B2B uses a different token |
| `BIG_GEAR_B2B_REPO`, `BIG_GEAR_B2B_REPO_REF`, `GITHUB_TOKEN` | The custom B2B Catalyst repo (`owner/repo`) |
| `PORTKEY_API_KEY`, `PORTKEY_MODEL` | AI gateway for Import and Enrich |

Install, OAuth and deployment variables are unchanged from the starter; see
`docs/INSTALL-ON-VERCEL.md` and `docs/VERCEL-DEPLOYMENT.md`.

## Checks

```bash
npx tsc --noEmit -p .
pnpm lint
pnpm test
pnpm build
```
