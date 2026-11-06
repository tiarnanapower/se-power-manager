import { FeaturePage, Kv, LoadError, NotConfigured, Planned, Section } from "@/components/features/ui";
import { getAppDataStore } from "@/lib/app-data/get-app-data-store";
import { countBigGearCompanies } from "@/lib/big-gear/b2b-api";
import { getCatalystRepoInfo } from "@/lib/big-gear/catalyst-repo";
import { getBigGearStatus } from "@/lib/big-gear/config";
import { listBigGearProducts } from "@/lib/big-gear/products-api";
import { listBigGearChannels, listBigGearThemes } from "@/lib/big-gear/themes-api";
import { toSafeMessage } from "@/lib/errors/app-error";
import { logError } from "@/lib/errors/logger";

const GEAR_STORE_VARS = ["BIG_GEAR_STORE_HASH", "BIG_GEAR_ACCESS_TOKEN"];

// ---- Catalog ---------------------------------------------------------------

// ---- Big Gear --------------------------------------------------------------

export async function BigGearProductsPage() {
  const status = getBigGearStatus();
  let products: Awaited<ReturnType<typeof listBigGearProducts>> | undefined;
  let failure: string | undefined;

  if (status.storeConfigured) {
    try {
      products = await listBigGearProducts({ limit: 8 });
    } catch (error) {
      logError("BigGearProductsPage", error);
      failure = toSafeMessage(error, "Couldn't read products from Big Gear.");
    }
  }

  return (
    <FeaturePage itemId="big-gear-products">
      {!status.storeConfigured ? (
        <NotConfigured what="The Big Gear store" vars={GEAR_STORE_VARS} />
      ) : failure ? (
        <LoadError header="Couldn't reach Big Gear" text={failure} />
      ) : (
        <Section title="Big Gear catalog" hint={`${products?.total ?? 0} products available. A preview of the first ${products?.items.length ?? 0}:`}>
          <table className="pp-table">
            <thead><tr><th>Name</th><th>SKU</th><th>Price</th><th>Visible</th></tr></thead>
            <tbody>
              {products?.items.map((product) => (
                <tr key={product.id}><td>{product.name}</td><td>{product.sku || "—"}</td><td>{product.price}</td><td>{product.is_visible ? "Yes" : "No"}</td></tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
      <Planned items={["Choose categories or individual products to copy.", "Copy images, variants and categories into your store.", "Tag copied products as demo-created.", "Log the import to Activity."]} />
    </FeaturePage>
  );
}

export async function BigGearStencilPage() {
  const status = getBigGearStatus();
  let themes: Awaited<ReturnType<typeof listBigGearThemes>> = [];
  let channels: Awaited<ReturnType<typeof listBigGearChannels>> = [];
  let failure: string | undefined;

  if (status.storeConfigured) {
    try {
      [themes, channels] = await Promise.all([listBigGearThemes(), listBigGearChannels()]);
    } catch (error) {
      logError("BigGearStencilPage", error);
      failure = toSafeMessage(error, "Couldn't read themes and channels from Big Gear.");
    }
  }

  return (
    <FeaturePage itemId="big-gear-stencil">
      {!status.storeConfigured ? (
        <NotConfigured what="The Big Gear store" vars={GEAR_STORE_VARS} />
      ) : failure ? (
        <LoadError header="Couldn't reach Big Gear" text={failure} />
      ) : (
        <>
          <Section title="Big Gear themes">
            <ul className="pp-list">{themes.map((theme) => <li key={theme.uuid}>{theme.name}{theme.variations?.length ? ` (${theme.variations.length} variations)` : ""}</li>)}</ul>
          </Section>
          <Section title="Big Gear channels">
            <ul className="pp-list">{channels.map((channel) => <li key={channel.id}>{channel.name}{channel.platform ? ` · ${channel.platform}` : ""}</li>)}</ul>
          </Section>
        </>
      )}
      <Planned items={["Download the Big Gear theme and upload it to your store.", "Create a Stencil channel (or use an existing one) and activate the theme on it.", "Copy theme configuration so the storefront looks the same.", "Log the pull to Activity."]} />
    </FeaturePage>
  );
}

export async function BigGearB2bPage() {
  const status = getBigGearStatus();
  let companies: number | undefined;
  let repoText: string | undefined;
  let b2bFailure: string | undefined;
  let repoFailure: string | undefined;

  if (status.storeConfigured) {
    const [companyResult, repoResult] = await Promise.allSettled([countBigGearCompanies(), status.repoConfigured ? getCatalystRepoInfo() : Promise.resolve(undefined)]);

    if (companyResult.status === "fulfilled") companies = companyResult.value;
    else {
      logError("BigGearB2bPage:b2b", companyResult.reason);
      b2bFailure = toSafeMessage(companyResult.reason, "Couldn't reach the B2B Edition API.");
    }

    if (repoResult.status === "fulfilled" && repoResult.value) repoText = `${repoResult.value.fullName} (${repoResult.value.defaultBranch}${repoResult.value.isPrivate ? ", private" : ""})`;
    else if (repoResult.status === "rejected") {
      logError("BigGearB2bPage:repo", repoResult.reason);
      repoFailure = toSafeMessage(repoResult.reason, "Couldn't read the Catalyst repo.");
    }
  }

  return (
    <FeaturePage itemId="big-gear-b2b">
      {!status.storeConfigured ? (
        <NotConfigured what="The Big Gear store" vars={GEAR_STORE_VARS} />
      ) : (
        <Section title="Connections">
          <Kv label="B2B Edition API">{b2bFailure ? <LoadError header="Unavailable" text={b2bFailure} /> : <>Reachable{companies !== undefined ? ` · ${companies} companies` : ""}</>}</Kv>
          <Kv label="Catalyst repo">
            {!status.repoConfigured ? <>Not configured (set <code>BIG_GEAR_B2B_REPO</code>)</> : repoFailure ? <LoadError header="Unavailable" text={repoFailure} /> : repoText}
          </Kv>
        </Section>
      )}
      <Planned items={["Create a Catalyst channel in your store and connect it to the Big Gear B2B repo.", "Optionally copy the B2B data: companies, users, company groups and shared catalogs.", "Show each step's progress and log the pull to Activity."]} />
    </FeaturePage>
  );
}

// ---- Store Health & Activity ----------------------------------------------

export function StoreHealthPage() {
  return (
    <FeaturePage itemId="store-health">
      <Planned
        items={[
          "Score your catalog and list products with no image, no description or zero stock.",
          "Flag products not assigned to a channel, or hidden by mistake.",
          "One-click fixes: hand the list to Enrich, or bulk-edit visibility and inventory.",
        ]}
      />
    </FeaturePage>
  );
}

export async function ActivityPage({ params }: { params: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = (await params).storeHash;
  const storeHash = Array.isArray(raw) ? raw[0] : raw;
  const entries = await getAppDataStore().listActivity({ storeHash, limit: 50 });

  return (
    <FeaturePage itemId="activity">
      <Section title="Recent activity">
        {entries.length === 0 ? (
          <div className="pp-empty">Nothing yet. Imports, pulls and bulk changes will be recorded here.</div>
        ) : (
          <table className="pp-table">
            <thead><tr><th>When</th><th>What</th><th>By</th><th>Result</th></tr></thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{new Date(entry.createdAt).toLocaleString("en-GB")}</td>
                  <td>{entry.summary}</td>
                  <td>{entry.userEmail ?? "—"}</td>
                  <td>{entry.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </FeaturePage>
  );
}
