-- Packs belong to the store that saved them and stay private to it until published.
-- Packs saved before this existed have no owner (NULL): they are only visible once
-- published, since there is no safe way to tell which store they came from.
ALTER TABLE packs ADD COLUMN store_hash TEXT;
CREATE INDEX packs_store_hash_idx ON packs (store_hash);
