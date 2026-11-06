import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteAppDataStore } from "@/lib/app-data/sqlite-store";
import type { PackProduct } from "@/lib/app-data/types";

const product = (name: string): PackProduct => ({ name, sku: name, price: 1, description: null, imageUrls: [], categoryPaths: ["A > B"], raw: { fields: { weight: 2 } } });

let dir: string;
let store: SqliteAppDataStore;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "se-pm-"));
  store = new SqliteAppDataStore(path.join(dir, "nested", "app.sqlite"));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("SqliteAppDataStore", () => {
  it("creates its folder and round-trips a pack, in order, in pages", async () => {
    const saved = await store.savePack({ name: "P", description: "d", source: "store", createdByEmail: "a@b.c", storeHash: "s1", products: ["x", "y", "z"].map(product) });

    expect(saved.productCount).toBe(3);
    expect((await store.listPacks())[0]).toMatchObject({ name: "P", productCount: 3, createdByEmail: "a@b.c" });
    expect((await store.getPack(saved.id))?.products.map((p) => p.name)).toEqual(["x", "y", "z"]);

    const page = await store.getPackPage(saved.id, 1, 1);

    expect(page?.products.map((p) => p.name)).toEqual(["y"]);
    expect(page?.pack.productCount).toBe(3);
    expect(await store.getPackPage("missing", 0, 1)).toBeUndefined();
  });

  it("deleting a pack removes its products", async () => {
    const saved = await store.savePack({ name: "P", description: "", source: "store", createdByEmail: null, storeHash: "s1", products: [product("x")] });

    await store.deletePack(saved.id);
    expect(await store.listPacks()).toEqual([]);
    expect(await store.getPack(saved.id)).toBeUndefined();
  });

  it("logs and filters activity by store, newest first", async () => {
    await store.logActivity({ storeHash: "s1", userEmail: null, kind: "k", summary: "first", status: "success" });
    await store.logActivity({ storeHash: "s2", userEmail: "u@x.y", kind: "k", summary: "other", status: "failed", undo: { packId: "p" } });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await store.logActivity({ storeHash: "s1", userEmail: null, kind: "k", summary: "second", status: "partial" });

    expect((await store.listActivity({ storeHash: "s1" })).map((a) => a.summary)).toEqual(["second", "first"]);
    expect((await store.listActivity({ storeHash: "s2" }))[0].undo).toEqual({ packId: "p" });
    expect(await store.listActivity()).toHaveLength(3);
  });

  it("tracks demo products per store and drops them on uninstall", async () => {
    await store.recordDemoProducts("s1", [3, 1, 2], null);
    await store.recordDemoProducts("s1", [2], null);
    await store.recordDemoProducts("s2", [9], null);

    expect(await store.listDemoProductIds("s1")).toEqual([1, 2, 3]);

    await store.forgetDemoProducts("s1", [1]);
    expect(await store.listDemoProductIds("s1")).toEqual([2, 3]);

    await store.deleteStoreData("s1");
    expect(await store.listDemoProductIds("s1")).toEqual([]);
    expect(await store.listDemoProductIds("s2")).toEqual([9]);
  });
});

describe("SqliteAppDataStore publishing", () => {
  const input = (name: string, source: "store" | "backup" = "store") => ({ name, description: "orig", source, createdByEmail: "a@b.c", storeHash: "s1", products: [product("x")] });

  it("lists published packs with the publisher's name, and can filter and unpublish", async () => {
    const a = await store.savePack(input("A"));
    const b = await store.savePack(input("B"));

    expect(a.publishedAt).toBeNull();

    const published = await store.publishPack(a.id, { publishedBy: "Alex", description: "new words" });

    expect(published).toMatchObject({ name: "A", description: "new words", publishedBy: "Alex", productCount: 1 });
    expect(published?.publishedAt).toBeTruthy();
    expect((await store.listPacks({ published: true })).map((p) => p.name)).toEqual(["A"]);
    expect((await store.listPacks({ published: false })).map((p) => p.name)).toEqual(["B"]);
    expect(await store.listPacks()).toHaveLength(2);

    // Leaving the description out keeps the existing one.
    await store.publishPack(b.id, { publishedBy: "Sam" });
    expect((await store.getPack(b.id))?.description).toBe("orig");

    await store.unpublishPack(a.id);
    expect((await store.listPacks({ published: true })).map((p) => p.name)).toEqual(["B"]);
    expect((await store.getPack(a.id))?.publishedBy).toBeNull();
  });

  it("will not publish a backup, or a pack that doesn't exist", async () => {
    const backup = await store.savePack(input("Backup", "backup"));

    expect(await store.publishPack(backup.id, { publishedBy: "Alex" })).toBeUndefined();
    expect(await store.publishPack("missing", { publishedBy: "Alex" })).toBeUndefined();
    expect(await store.listPacks({ published: false, includeBackups: false })).toEqual([]);
    expect(await store.listPacks({ published: false })).toHaveLength(1);
  });

  it("adds the publishing columns to a database created before they existed", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const file = path.join(dir, "old.sqlite");
    const old = new DatabaseSync(file);

    old.exec("CREATE TABLE packs (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, created_by_email TEXT, created_at TEXT NOT NULL)");
    old.prepare("INSERT INTO packs (id, name, source, created_at) VALUES ('p1', 'Old pack', 'store', '2026-01-01T00:00:00Z')").run();
    old.close();

    const upgraded = new SqliteAppDataStore(file);

    expect((await upgraded.listPacks())[0]).toMatchObject({ name: "Old pack", publishedAt: null });
    expect(await upgraded.publishPack("p1", { publishedBy: "Alex" })).toMatchObject({ publishedBy: "Alex" });
  });
});

describe("SqliteAppDataStore previews", () => {
  it("stores a preview with the pack and returns it from list and page reads", async () => {
    const saved = await store.savePack({
      name: "P",
      description: "",
      source: "store",
      createdByEmail: null,
      storeHash: "s1",
      products: [{ ...product("Tent"), imageUrls: ["t.jpg"], categoryPaths: ["Outdoor > Tents"] }, { ...product("Lamp"), categoryPaths: [] }],
    });

    expect(saved.preview).toEqual({ images: ["t.jpg"], categories: ["Outdoor"], names: ["Tent", "Lamp"] });
    expect((await store.listPacks())[0].preview).toEqual(saved.preview);
    expect((await store.getPackPage(saved.id, 0, 1))?.pack.preview).toEqual(saved.preview);
  });

  it("backfills a preview for packs saved before the column existed", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const file = path.join(dir, "older.sqlite");
    const old = new DatabaseSync(file);

    old.exec("CREATE TABLE packs (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, created_by_email TEXT, created_at TEXT NOT NULL, published_at TEXT, published_by TEXT)");
    old.exec("CREATE TABLE pack_products (id INTEGER PRIMARY KEY AUTOINCREMENT, pack_id TEXT NOT NULL, position INTEGER NOT NULL, payload TEXT NOT NULL)");
    old.prepare("INSERT INTO packs (id, name, source, created_at) VALUES ('p1', 'Old', 'store', '2026-01-01T00:00:00Z')").run();
    old.prepare("INSERT INTO pack_products (pack_id, position, payload) VALUES ('p1', 0, ?)").run(JSON.stringify({ ...product("Boot"), imageUrls: ["boot.jpg"], categoryPaths: ["Shoes"] }));
    old.close();

    const upgraded = new SqliteAppDataStore(file);

    expect((await upgraded.listPacks())[0].preview).toEqual({ images: ["boot.jpg"], categories: ["Shoes"], names: ["Boot"] });
  });
});

describe("SqliteAppDataStore image state", () => {
  const withImage = (name: string, url: string): PackProduct => ({ ...product(name), imageUrls: [url] });

  it("defaults to skipped, can be saved as pending, and is returned by every read", async () => {
    const plain = await store.savePack({ name: "A", description: "", source: "store", createdByEmail: null, storeHash: "s1", products: [product("x")] });
    const pending = await store.savePack({ name: "B", description: "", source: "store", createdByEmail: null, storeHash: "s1", products: [product("x")], imagesState: "pending" });

    expect(plain.imagesState).toBe("skipped");
    expect(pending.imagesState).toBe("pending");
    expect((await store.getPackPage(pending.id, 0, 1))?.pack.imagesState).toBe("pending");
    expect((await store.listPacks()).map((p) => p.imagesState).sort()).toEqual(["pending", "skipped"]);
  });

  it("rewrites products in place by position, and updates state and preview together", async () => {
    const saved = await store.savePack({ name: "P", description: "", source: "store", createdByEmail: null, storeHash: "s1", products: [withImage("a", "https://old/a.jpg"), withImage("b", "https://old/b.jpg"), withImage("c", "https://old/c.jpg")], imagesState: "pending" });

    await store.updatePackProducts(saved.id, 1, [withImage("b", "https://new/b.jpg"), withImage("c", "https://new/c.jpg")]);
    await store.setPackImages(saved.id, "preserved", { images: ["https://new/b.jpg"], categories: [], names: ["a"] });

    const pack = await store.getPack(saved.id);

    expect(pack?.products.map((p) => p.imageUrls[0])).toEqual(["https://old/a.jpg", "https://new/b.jpg", "https://new/c.jpg"]);
    expect(pack?.imagesState).toBe("preserved");
    expect(pack?.preview.images).toEqual(["https://new/b.jpg"]);
  });

  it("adds the column to a database created before it existed, as skipped", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const file = path.join(dir, "pre-images.sqlite");
    const old = new DatabaseSync(file);

    old.exec("CREATE TABLE packs (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, created_by_email TEXT, created_at TEXT NOT NULL, published_at TEXT, published_by TEXT, preview TEXT)");
    old.prepare("INSERT INTO packs (id, name, source, created_at) VALUES ('p1', 'Old', 'store', '2026-01-01T00:00:00Z')").run();
    old.close();

    expect((await new SqliteAppDataStore(file).listPacks())[0].imagesState).toBe("skipped");
  });
});
