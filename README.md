# Promo Calendar for BigCommerce

A marketing calendar and promotion scheduler that installs into a BigCommerce
store. It shows every live and scheduled promotion on one timeline, lets you
create and edit promotions by chatting with an AI copilot, views promotions by
customer audience, recommends what to run next, and previews how a promotion
looks on the storefront.

> Status: early build. See [docs/PLAN.md](docs/PLAN.md) for scope and roadmap.

## Built on

The BigCommerce single-click app starter
([`bigcommerce-edu/starter-sc-app-next`](https://github.com/bigcommerce-edu/starter-sc-app-next)):
OAuth install and launch, signed sessions, per-store credentials, REST and
GraphQL clients, BigDesign UI. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Run locally

```bash
pnpm install
cp .env.example .env.local   # then fill in the values
pnpm dev                     # http://localhost:3000
```

`DATA_MODE=STATIC` with `STATIC_STORE_HASH` and `STATIC_STORE_TOKEN` runs
against one store without installing the app. `DATA_MODE=MOCK` is the demo mode
(no store). `DATA_MODE=MULTITENANT` is the installed app.

The API token needs: Marketing (modify), Products (read-only), Customers
(read-only), Orders (read-only).

## Safety

The copilot never writes straight to a store. Every change is shown as a draft
with a diff and applied only after you confirm; new promotions are created
disabled. Secrets are server-side only.
