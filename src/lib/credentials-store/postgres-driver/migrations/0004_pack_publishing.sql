-- A pack becomes part of the Shared Catalog when published. published_by is
-- the display name the publisher typed, not an email.
ALTER TABLE packs
  ADD COLUMN published_at TIMESTAMPTZ,
  ADD COLUMN published_by TEXT;

CREATE INDEX packs_published_idx ON packs (published_at) WHERE published_at IS NOT NULL;
