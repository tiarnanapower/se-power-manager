-- A small summary of each pack (sample images, top categories, first names) so
-- the UI can draw a pack as a card without loading its products.
ALTER TABLE packs ADD COLUMN preview JSONB;

-- Backfill packs saved before this column existed: up to four first-images,
-- taken from products that have one. Categories and names are left empty and
-- fill in for packs saved from now on.
UPDATE packs p
SET preview = jsonb_build_object(
  'images', COALESCE((
    SELECT jsonb_agg(image)
    FROM (
      SELECT payload -> 'imageUrls' ->> 0 AS image
      FROM pack_products
      WHERE pack_id = p.id AND jsonb_array_length(payload -> 'imageUrls') > 0
      ORDER BY position
      LIMIT 4
    ) AS picked
  ), '[]'::jsonb),
  'categories', '[]'::jsonb,
  'names', COALESCE((
    SELECT jsonb_agg(payload ->> 'name')
    FROM (SELECT payload FROM pack_products WHERE pack_id = p.id ORDER BY position LIMIT 3) AS first_three
  ), '[]'::jsonb)
);
