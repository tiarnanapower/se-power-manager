# CLAUDE.md

SE Power Manager: a private BigCommerce single-click app (Next.js, BigDesign) that
helps solutions engineers set up demo stores. Forked from the Power Promotions
starter; see docs/ARCHITECTURE.md for the auth, session, data-mode and API-client
layers (its gift-certificate examples are historical) and docs/PLAN.md for what is
built and what is next.

## Working rules

- Never write to a live store (create, update or delete products, channels, themes)
  without the user's explicit go-ahead. Reads are fine.
- Big Gear is read-only. Never write to it; its token lives in env and is server-only.
- Never print or log `.env.local` values or tokens. Report key names only.
- Store tokens, the Big Gear token, the GitHub token and the AI key stay
  server-side (`server-only`); the model never sees a token.
- Every Server Action and route handler calls `isAuthorizedForStore`.
- Destructive actions (clear, restore over existing data) need a dry-run count,
  explicit confirmation and an automatic pack saved first.
- Pack images are copied to Vercel Blob when a pack is saved (`preserveImages`); a clear must never delete before its backup's images are copied (`clearBatch` enforces it).
- Everything the app changes is recorded through `getAppDataStore().logActivity`.
- Menu structure lives in `src/components/shell/nav-items.ts` (one source for the
  sidebar, header titles and page descriptions).
- Node 24 and pnpm are required (`.nvmrc`). Checks: `npx tsc --noEmit -p .`,
  `pnpm lint`, `pnpm test`, `pnpm build`.
