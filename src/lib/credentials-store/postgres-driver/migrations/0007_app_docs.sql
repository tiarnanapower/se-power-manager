-- Small JSON documents scoped to one store: the Enrich Tool's analysis queue
-- and its uploaded images. Bodies are JSON text; `seq` keeps insert order.
CREATE TABLE app_docs (
  collection TEXT NOT NULL,
  store_hash TEXT NOT NULL,
  id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  seq BIGSERIAL,
  PRIMARY KEY (collection, store_hash, id)
);
