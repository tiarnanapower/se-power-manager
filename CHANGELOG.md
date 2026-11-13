# Changelog

Everything built in SE Power Manager, newest first. Dates are commit dates; the short hash after each
heading is the commit that shipped it. Items marked **untested** were built and unit-tested against
fake stores, but have not been run against a real BigCommerce store.

Names changed along the way. Current names first, old names in brackets:

| Now | Was |
| --- | --- |
| Snapshot Manager (menu group) | Catalog, then Import |
| Demo Snapshots | Shared Catalog, then Sample Catalog, then Store Templates |
| My Snapshots | Restore & Clear, then Personal Catalog |
| Import From External Site | Import Tool |
| Utilities > Deploy Catalyst Storefront | (new; replaced Big Gear in the menu) |

---

## 2026-11-12

### Import From External Site: Site brief for Makeswift
- A second tab on the Import page turns a customer's home page into a **brief for the Makeswift template**. Nothing is written to the store or to Makeswift.
- **Brand kit:** the colours matched to the template's four swatches (Primary, Secondary, Tertiary, Neutral), heading and body fonts, logo, phone, email, address and social links, read straight from the site and its stylesheets with no AI. The page asks the SE to check them, because a stylesheet doesn't say which colour is the brand's.
- **Copy for every section** of the template (Image Banner, Featured Categories, B2C and B2B slots and video banners, Best Sellers, Shop the look, Sign-up), within each field's length, with a copy button on each. Slots use real text over a background picture.
- **Picture and video briefs:** for each slot, the size, an image prompt, alt text, and for videos a shot list and stock search words. The app does not generate images.
- **Audiences:** B2C (on by default) and B2B, each with optional customer groups from the store, named on the slot's "Targeted customer groups". At least one audience always stays on.
- **Run in Claude:** instructions to paste into Claude in Chrome that fill the SE's own copy of the template: set the colours and fonts, edit each Global component, never publish. **Untested in Makeswift: a pilot on a copy of the template is next.**

### Clear: more sections
- **Clear sections** can now clear **B2B Edition** (companies, then custom roles), **Pricing** (price lists and extra currencies), **Shipping** (zones and methods), **Tax** (rates and zones) and **Inventory** (stock locations), as well as the catalog.
- Storefront, Checkout and Localization stay greyed out with the reason: they are settings and translations, which can only be replaced by importing, not deleted.
- The same two steps apply: a snapshot of what will go is downloaded first (it now includes the chosen sections, and can have no products), then you delete. Things BigCommerce won't let anyone delete are left alone: the default currency, the default tax zone, tax classes, the default location, and the last shipping zone (its methods are removed). Anything else refused is listed. **Untested against real stores.**

### Wawaweewa: custom roles, quotes and orders
- Three new tick boxes on the Wawaweewa page: **Custom roles**, **Quotes** and **Orders**. Each SE chooses what to bring in.
- **Custom roles** are copied first, and users are given the role they had. **Quotes** are recreated for their company with products matched by SKU. **Orders** are created as real orders for the matching buyer and attached to their company.
- Quotes and orders need the catalog and the companies and users to be in the store already, and anything that can't be matched is skipped with a reason. Orders need the app to have Orders modify, and the source token needs Orders read-only. **Untested against real stores.**
- The destination store's B2B refusal now says it is the destination, and gives B2B's own reason.

### Utilities > Wawaweewa
- A new Utilities item that imports from a **shared source store that has B2B data** into the SE's own store. It plays the part the Big Gear pages were meant to, but the source is a different store, set by the operator with `WAWAWEEWA_STORE_HASH` and `WAWAWEEWA_ACCESS_TOKEN` (read-only use; the same token reaches that store's B2B API). SEs never see the token.
- **Catalog:** products, categories, brands, variants, options, custom fields, pick lists (linked in a second pass) and pictures. Pictures are fetched from the source store's CDN by BigCommerce itself. Products with an existing SKU are skipped.
- **B2B companies and users:** each company with its administrator and other users. Existing company names are skipped. Quotes, orders and custom roles are not copied.
- The page shows the source's product and company counts with a short preview before anything is imported, then a progress bar with Stop. **Untested against a real import.**

### Demo Snapshots read from a private repo
- The default repo is now **`BigCommerceDemo/se-demo-catalogs`** (branch `main`). It is private, so `SAMPLES_GITHUB_TOKEN` must be set (a fine-grained token with Contents: read-only on that repo) in Vercel and in `.env.local`, then redeployed. The capture script's default output folder is now `../se-demo-catalogs`.

### Names and menu (`9aa716a`)
- **Store Templates is now Demo Snapshots.** Renamed in the menu, page text, dialogs, comments and `.env.example`. Web addresses are unchanged, so old links still work.
- **The Import menu group is now Snapshot Manager.** It holds Demo Snapshots, My Snapshots and Import From External Site.
- Deploy Catalyst Storefront: the GitHub repo field is now **Destination GitHub repo**.

### Deploy Catalyst fields (`08aa894`)
- An empty field is marked "needed" in purple instead of showing as a red error. Red is kept for a value that was typed but can't be used, and appears under that field only.
- The project folder fills in from the repo name until you type your own.
- A grey status line says what is still to fill in, and the example command stays visible until the form is valid.

### Six more snapshot sections (`e62a966`)
Pricing, Storefront, Checkout, Inventory, Localization and B2B can now be saved into a snapshot and imported. Saving was checked against a real store. **Importing is untested.**
- **Pricing & currencies:** currencies, price lists, prices by SKU (so import the catalog first) and assignments to customer groups and channels by name. The store's default currency is never changed.
- **Storefront settings:** search, SEO, product and category display, robots.txt, security and catalog. Replaces the target's values. Maintenance status and the store profile are deliberately not copied.
- **Checkout & customer experience:** checkout, cart and abandoned-cart settings. Replaces the target's values, keeps the target's own contact emails, and drops custom checkout files hosted in the source store.
- **Inventory & locations:** inventory settings and stock locations (matched by code). Plan limits on locations show as warnings.
- **Localization:** languages per channel, the default language, and product translations by SKU, through the GraphQL Admin API. The default-language picker in the import popup now works.
- **B2B Edition:** companies and their users, through the B2B API. Quotes, orders and custom roles are not copied.
- Fixes found by running against a real store: robots.txt lives at `robotstxt`, GraphQL channel arguments are `ID!`, and the B2B API needs the store hash sent as a header.
- The capture script reads all of these sections, including B2B.

### Snapshots replace the personal catalog (`147861d`)
- **Download a snapshot:** saves the connected store as a zip in the Demo Snapshots format (products with variants, options, custom fields and pictures, plus Shipping and Tax at the time). Nothing is stored on a server.
- **Upload a snapshot:** drop in a zip or a folder, look through the products (with full details and pictures) and load it into a store through the same Import sections popup as Demo Snapshots. **Loading is untested against a real store.**
- **Clear your store:** step 1 downloads a snapshot of exactly the products about to go, step 2 deletes them. To undo, upload the zip.
- **Older saved catalogs:** packs already on the server stay listed so they can be opened and downloaded as snapshots, then deleted. They can no longer be loaded into a store directly.
- **Vercel Blob removed:** the dependency, the image-storage setting and `BLOB_READ_WRITE_TOKEN` are gone. This ended the "Advanced Operations 2.4k/2k" limit on the Vercel dashboard.
- One shared sample-building routine now serves the capture script, the snapshot download and the pack export, so they all produce the same layout. Includes a small ZIP writer and reader (no new dependency).

### Utilities > Deploy Catalyst Storefront (`147861d`)
- New menu section **Utilities** with a page of copy-and-paste terminal commands that create a Catalyst storefront with native BigCommerce hosting.
- **B2B and B2C tabs.** Both commands include `--hosting bigcommerce`.
- **Collaborative GitHub option:** asks for the repo and branch, adds the project folder, `cd`, `git remote add origin`, `git checkout -b` and `git push -u`. Repo, branch and folder names are checked so nothing can add shell commands.
- Big Gear is hidden from the menu but its pages, code and tests are kept.

### Design (`31f715c`, `5a5a77f`)
- The selected menu item has a soft purple fill with a thin border, with no left bar.
- Purple is now **flat** (`#4a2fd0`, with `#170245` as the deep tone). All gradients, glows and shadows are removed from buttons, menu, progress bars, tabs, chips and cards.
- **Commerce logo mark** (without the wordmark) replaces the old icon in the sidebar and browser tab.

---

## 2026-11-11

### Menu and export (`ae3f62d`, `34cb948`)
- The **Import** and **Big Gear** groups drop down when clicked. The group you are in is open by default.
- **Import Tool renamed Import From External Site.**
- The menu group now holds Sample Catalog, Personal Catalog and Import From External Site; Enrich Tool moved to its own entry.
- **Export for the sample repo** (later became "Download as a snapshot"): packs a saved catalog into the repo layout as a zip, numbering the next version when the sample already exists and updating the index.

### Personal Catalog and first settings sections (`06ac7f1`)
- Renamed the Restore & Clear page to **Personal Catalog**. Saved catalogs appear as cards that open into a page with their products and a product popup.
- **Restore popup** with sections, and a **Clear popup** listing the areas that can be cleared (only the catalog at that point).
- **Shipping** (zones and methods) and **Tax** (zones, rates, classes and settings) added to capture and import. Both are additive and match by name.

### Fixes and design (`9ff67f7`)
- Removed "Raw sample data" from the product popup.
- The import progress bar shows from the start.
- Sample picture uploads fixed: they use multipart upload to the product, and a Blob sign-in problem is reported as a sign-in problem instead of "image already gone".
- First purple gradient design for buttons, menu pill, progress bars and tabs (replaced on 2026-11-12).

### Sample Catalog (`cc95b43`)
- **Sample Catalog replaces the Shared Catalog.** Samples are read from a public GitHub repo (`tiarnanapower/bc-sample-data`) as JSON and images, with no database or Blob. Only the repo owner can change them.
- **Versioned samples** with a visible version history from GitHub commits. Image files are shared by content hash.
- **Sample page:** Products, Categories and Versions & history tabs, with a product popup.
- **Import sections popup:** Catalog is selected by default; Shipping, Tax and the other sections are listed, with a language picker.
- **Pick lists fixed:** products that reference other products are now created in a second pass after all products exist, and a refused option no longer fails the whole product.
- **Capture script** (`pnpm samples:capture`): reads a store into repo files, which you commit yourself.
- **Brighter Commerce purples** and a smaller card layout for laptop screens.
- **Import From External Site AI prompt route:** a button in the corner, offered automatically when scraping finds nothing, so the AI can read the page and the pasted result is loaded.
- Reading the repo uses the GitHub API with a token, or `raw.githubusercontent.com` without one, with a short in-memory cache and a local-folder override for testing.

---

## 2026-11-06 and earlier

Built before this record was kept in detail; summarised from the commits.

- **Foundation (`71693bb`):** a BigCommerce single-click app starter on Next.js, with install, sessions and an encrypted store-credentials table, plus docs for Vercel, Cloudflare and local installs.
- **SE Power Manager shell (`487c5ce`):** the grouped menu (Catalog, Big Gear, Store Health, Activity, Settings), a route for every page, and the Big Gear connection (products, themes, channels, Catalyst repo info, B2B reachability), all read-only.
- **Packs, activity and demo-product tracking** with SQLite for local development and Postgres for Vercel.
- **Restore & Clear:** save a catalog as a pack, restore it in batches, and clear the store with a backup first.
- **Enrich Tool (`2651d4e`, `9a49c12`):** AI improvements to existing products, with an upload route and an analysis queue. An OCR attempt was removed again (`f89bc66`).
- **Import tool scraping (`c377119`):** scrape a customer site into products to review, with an SSRF guard.
- **Store Health (`632f673`):** a page that finds products with missing images, descriptions, stock or channel assignments.
- **Pack privacy (`a4b23e2`):** packs belong to the store that saved them, so other stores cannot see or restore them.
- Small fixes to Blob image storage, the AI gateway settings and the Vercel environment examples.

---

## Not yet verified against a real store

- Loading an uploaded snapshot into a store, including pictures and pick lists.
- Importing Shipping, Tax, Pricing, Storefront, Checkout, Inventory, Localization and B2B (saving all of them was checked on a real store).
- Reading and writing translations and price records: the test store had none.
- Very large catalogs are built in the browser's memory and have not been tried at thousands of products.
- The Postgres migrations (`0003` to `0008`) on the real Neon database.

## Known gaps

- Quotes, orders and custom B2B roles are not copied.
- Clear can't remove Storefront, Checkout or Localization: they are settings, so they can only be replaced.
- `docs/PLAN.md` still lists the original menu and several early phases, and needs refreshing.
- Big Gear is hidden from the menu, not removed.
