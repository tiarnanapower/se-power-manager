# Install Power Promotions on Vercel (single-click app)

This is the short, project-specific checklist. The general explanation is in
[VERCEL-DEPLOYMENT.md](./VERCEL-DEPLOYMENT.md); follow that for background and
troubleshooting. The Vercel tooling is already scaffolded (`vercel-build`
script and `.env.vercel.example`).

## 1. Put the code in Git

Vercel deploys from a Git repository. Create a **private** repo (GitHub), then
from the project folder:

```shell
git init && git add -A && git commit -m "Power Promotions"
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main
```

`.env.local` and other `.env*` files are ignored by `.gitignore`, so your store
token and Portkey key are not committed. Check `git status` shows no `.env.local`
before the first commit.

## 2. Create the Vercel project

1. Import the repo at <https://vercel.com/new>. Keep the Next.js defaults.
2. Add `DATA_MODE=MOCK` for the first deploy only (no database needed), deploy,
   and note the production URL, e.g. `https://power-promotions.vercel.app`.
3. **Storage** tab: create a **Neon** Postgres database and connect it.
   This adds `DATABASE_URL` and `DATABASE_URL_UNPOOLED`.

## 3. Register the app in the BigCommerce developer portal

At <https://devtools.bigcommerce.com/> create an app, then set (Technical tab):

| Callback | URL |
| --- | --- |
| Auth | `<APP_ORIGIN>/api/app/auth` |
| Load | `<APP_ORIGIN>/api/app/load` |
| Uninstall | `<APP_ORIGIN>/api/app/uninstall` |
| Remove User | `<APP_ORIGIN>/api/app/remove_user` |

Scopes this app needs:

| Scope | Level | Used for |
| --- | --- | --- |
| Marketing | modify | Read, schedule and create promotions and coupon codes |
| Products | read-only | Category, brand and product names for the copilot |
| Customers | modify | Customer groups, and customer segments: list, create, add customers (segments are an Enterprise feature) |
| Information & Settings | read-only | The store's time zone and currency |
| Channel Settings | read-only | Channel names |
| Channel Listings | read-only | Channel names (as the starter requires) |
| App Extensions | manage | Appearing in the control panel menu (as the starter requires) |

Orders (read-only) is only needed when order-history recommendations are added.

## 4. Environment variables (Production)

| Variable | Value |
| --- | --- |
| `DATA_MODE` | `MULTITENANT` |
| `CREDENTIALS_STORE_DRIVER` | `POSTGRES` |
| `APP_ORIGIN` | the production URL, no trailing slash |
| `BIGCOMMERCE_CLIENT_ID` / `BIGCOMMERCE_CLIENT_SECRET` | from the developer portal |
| `SESSION_SECRET` | `openssl rand -base64 32` |
| `CREDENTIALS_ENCRYPTION_KEY` | `openssl rand -base64 32` (do not change later) |
| `PORTKEY_API_KEY` | your Portkey key (server only) |
| `PORTKEY_BASE_URL` | `https://api.portkey.ai/v1` |
| `PORTKEY_MODEL` | `@dev-openai/gpt-5-mini` |
| `DEVELOPER_NAME`, `SUPPORT_EMAIL`, `SUPPORT_URL`, `SUPPORT_PHONE` | your branding |

Do not set `STATIC_STORE_HASH` or `STATIC_STORE_TOKEN` in Production.

## 5. Redeploy, then install

Redeploy (env changes only apply to new deployments). In the build log, confirm
the Postgres migration ran. Then in the store's control panel go to
**Apps > My Apps > My Draft Apps** and install it. The app opens inside the
control panel at `/store/<storeHash>/`.

## Before the demo

- Try rescheduling and the copilot's Apply on a **disabled test promotion**
  first; these write paths have not been exercised against a live store yet.
- Settings > Connection test confirms the token and scopes.
- Vercel Deployment Protection must be off (or scoped) for the URL BigCommerce
  calls, or installs fail at the Auth callback.
