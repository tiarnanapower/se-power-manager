# SE Power Manager: plan

Private BigCommerce app for solutions engineers. Multi-tenant: installs on each
SE's store and uses that store's API connection, and also connects to the shared
"Big Gear" demo store (read-only). Hosted on Vercel with Postgres.

## Menu

```
Catalog
  Shared Catalog      library of packs saved by anyone on the team
  Import Tool         AI scrape of a customer site -> review -> push
  Enrich Tool         AI improvements to products already in the store
  Restore & Clear     save/restore packs, bulk clear
Big Gear
  Product Import      copy products from Big Gear
  Stencil Channel Pull   copy the Big Gear theme/channel
  Custom B2B Channel Pull   Catalyst repo channel, optionally B2B data
Store Health
Activity
Settings
```

## Status

| Area | State |
| --- | --- |
| Install/session/credentials (from starter) | Done |
| Shell, grouped menu, route stubs for every page | Done |
| Big Gear connection (config, products, themes, channels, B2B reachability, Catalyst repo info) | Done, read-only |
| Big Gear pulls (`src/lib/big-gear/pulls.ts`) | Signatures only, bodies throw "not built" |
| Packs, activity, demo-product tracking: SQLite and Postgres stores | Done. SQLite tested; Postgres written but untested (no database available) |
| Saving user email on packs and activity | Done (MULTITENANT only; empty in MOCK/STATIC) |
| Restore & Clear: save pack, restore in batches, clear with backup | Done, tested against a fake BigCommerce catalog only |
| Shared Catalog: publish a saved pack under your name, list published packs, "Use this pack" opens Restore with it selected, remove | Done. SQLite store tested; Postgres migration `0004_pack_publishing.sql` untested |
| Image preservation to Vercel Blob (copy on save, gate clears on it) | Built, tested with the Blob SDK mocked. Needs `BLOB_READ_WRITE_TOKEN`; migration `0006_pack_images_state.sql` untested on Postgres |
| Pack cards (sample images, top categories, first names) in the Shared Catalog and pack library | Done. Migration `0005_pack_preview.sql` untested on Postgres |
| Import, Enrich, Store Health | Placeholder pages |

### Not yet verified against a real store

Restore & Clear has only run against an in-memory fake. Before relying on it, try it on a throwaway store:

- Creating a product with `variants` and `option_values` in one call (the code assumes BigCommerce builds the options itself).
- Categories use `/v3/catalog/categories` (the default tree). Stores with several category trees may need `tree_id`.
- **Images:** BigCommerce deletes a product's images when the product is deleted, so a pack that only links to them can't restore pictures (in the first real test only 4 of ~89 survived). Built: when a pack is saved, its images are copied to Vercel Blob in small batches and the pack is rewritten to point at the copies (`imagesState`: pending, preserved, partial, skipped). A clear refuses to delete until its backup's images are copied, or the SE explicitly accepts losing them when no Blob store is configured. Restore also checks each image URL first, leaves out dead ones, and retries a product without images if BigCommerce still refuses. **Not yet run against a real Blob store** (no token was available); the copy logic is tested with the SDK mocked.
- Not copied: modifiers, bulk pricing rules, product videos, tax classes, channel assignments beyond the default channel.
- Run the Postgres migration (`pnpm db:postgres:migrate`) and the Postgres store against a real database.

## Phases

1. Foundation. Done.
2. Persistence. Done.
3. Restore & Clear. Built; see "Not yet verified" above.
4. Import Tool: AI extraction (fetch page, clean it, `generateObject` with a Zod
   schema through Portkey), job model with polling (serverless time limits), SSRF
   guard, review grid, push.
5. Big Gear pulls: products, then Stencil (download theme job, upload, create
   channel, activate with `variation_id` + `configuration_id` + `channel_id`), then
   B2B (create Catalyst channel, connect repo, optional B2B data copy).
6. Enrich Tool, Store Health.
7. Marketplace readiness (private app): scopes review, uninstall data handling,
   privacy and support details, load testing the install flow.

## BigCommerce constraints to design around

- v3 has no batch product create: creation is one request per product, rate limited.
- Batch product updates: 10 per request; batch deletes: 250 ids per request.
- Theme upload: zip up to 50 MB, at most 20 custom themes per store; activate needs
  `variation_id`, `configuration_id` and `channel_id` (the `which` shortcut is not
  supported with multi-storefront).
- B2B Edition API: `https://api-b2b.bigcommerce.com/api`, headers `X-Auth-Token` and
  `X-Store-Hash`.
