-- Shared packs and the activity log. Not keyed to a store: packs are a
-- team-wide library, and activity rows keep store_hash only as a label.
CREATE TABLE packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  created_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pack_products (
  id BIGSERIAL PRIMARY KEY,
  pack_id UUID NOT NULL REFERENCES packs (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  payload JSONB NOT NULL
);

CREATE INDEX pack_products_pack_id_idx ON pack_products (pack_id, position);

CREATE TABLE activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_hash TEXT,
  user_email TEXT,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL,
  undo JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE demo_products (
  store_hash TEXT NOT NULL,
  product_id BIGINT NOT NULL,
  pack_id UUID REFERENCES packs (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_hash, product_id)
);

CREATE INDEX activity_log_store_created_idx ON activity_log (store_hash, created_at DESC);
