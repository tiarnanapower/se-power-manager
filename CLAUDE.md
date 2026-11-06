# CLAUDE.md

Promo Calendar: a BigCommerce single-click app (Next.js, BigDesign) with a
promotion calendar and an AI copilot. Based on the BigCommerce starter; see
docs/ARCHITECTURE.md for the auth, session, data-mode and API-client layers.

## Working rules

- Never write to a live store (create, update or delete promotions) without the
  user's explicit go-ahead. Reads are fine. New promotions are created disabled.
- Never print or log `.env.local` values or tokens. Report key names only.
- The store token and AI key stay server-side (`server-only`); the model never
  sees the token.
- Every Server Action and route handler calls `isAuthorizedForStore`.
- Keep unknown promotion fields intact on edit (round-trip them).
- Checks: `npx tsc --noEmit -p .`, `pnpm lint`, `pnpm build`.
