// The slice of BigCommerce's v3 catalog resources this app reads and writes.
// Fields are optional because the API omits or nulls many of them.

export interface BcImage {
  url_zoom?: string;
  url_standard?: string;
  is_thumbnail?: boolean;
  sort_order?: number;
  description?: string;
}

export interface BcOptionValue {
  option_display_name: string;
  label: string;
}

export interface BcVariant {
  sku?: string;
  price?: number | null;
  sale_price?: number | null;
  retail_price?: number | null;
  weight?: number | null;
  width?: number | null;
  height?: number | null;
  depth?: number | null;
  inventory_level?: number | null;
  is_free_shipping?: boolean;
  purchasing_disabled?: boolean;
  image_url?: string;
  option_values?: BcOptionValue[];
}

export interface BcProduct {
  id: number;
  name: string;
  brand_id?: number;
  categories?: number[];
  variants?: BcVariant[];
  images?: BcImage[];
  custom_fields?: { name: string; value: string }[];
  [field: string]: unknown;
}

export interface BcCategory {
  id: number;
  parent_id: number;
  name: string;
}

export interface BcBrand {
  id: number;
  name: string;
}
