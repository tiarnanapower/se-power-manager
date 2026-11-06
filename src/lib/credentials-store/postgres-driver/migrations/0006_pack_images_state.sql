-- Whether a pack's images have been copied to durable storage. Existing packs
-- only hold links to the source store's images, so they are 'skipped'.
ALTER TABLE packs ADD COLUMN images_state TEXT NOT NULL DEFAULT 'skipped';
