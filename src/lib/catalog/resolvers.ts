// Find-or-create for the things a pack refers to by name: brands and category
// paths. One resolver per restore batch; it loads the store's existing ones
// once and remembers what it creates.
import type { BcRestApiClient } from "@/lib/bc-api-client/rest-client/types";
import { createBrand, createCategory, fetchBrands, fetchCategories } from "@/lib/catalog/catalog-api";
import { CATEGORY_SEPARATOR } from "@/lib/catalog/pack-mapper";

const key = (text: string) => text.trim().toLowerCase();

export class NameResolver {
  private brands = new Map<string, number>();
  // "parentId|name" -> id, so the same name under different parents stays distinct.
  private categories = new Map<string, number>();
  private loaded = false;

  constructor(private readonly client: BcRestApiClient) {}

  private async load(): Promise<void> {
    if (this.loaded) return;

    const [brands, categories] = await Promise.all([fetchBrands(this.client), fetchCategories(this.client)]);

    brands.forEach((brand) => this.brands.set(key(brand.name), brand.id));
    categories.forEach((category) => this.categories.set(`${category.parent_id}|${key(category.name)}`, category.id));
    this.loaded = true;
  }

  async brandId(name: string | null): Promise<number | undefined> {
    if (!name) return undefined;

    await this.load();

    const existing = this.brands.get(key(name));

    if (existing) return existing;

    const id = await createBrand(this.client, name);

    this.brands.set(key(name), id);

    return id;
  }

  // "Outdoor > Tents" resolves (creating as needed) to the id of "Tents".
  async categoryId(path: string): Promise<number> {
    await this.load();

    let parentId = 0;

    for (const name of path.split(CATEGORY_SEPARATOR)) {
      const cacheKey = `${parentId}|${key(name)}`;
      let id = this.categories.get(cacheKey);

      if (!id) {
        id = await createCategory(this.client, name.trim(), parentId);
        this.categories.set(cacheKey, id);
      }

      parentId = id;
    }

    return parentId;
  }
}
