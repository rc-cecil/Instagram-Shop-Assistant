-- Preserve legacy identifiers and history without requiring Google for new shops.
ALTER TABLE shops ALTER COLUMN drive_folder_id DROP NOT NULL;
ALTER TABLE shops ALTER COLUMN tracker_sheet_id DROP NOT NULL;
ALTER TABLE shops ALTER COLUMN google_credential_env DROP NOT NULL;
