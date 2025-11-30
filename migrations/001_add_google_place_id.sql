-- Migration: Add google_place_id column to places table
-- Purpose: Fast lookup and association of Google Places POI data with local data
-- Date: 2025-11-25

-- Add the google_place_id column (nullable for backward compatibility)
ALTER TABLE places
ADD COLUMN IF NOT EXISTS google_place_id TEXT;

-- Create unique constraint (a Google Place ID should only appear once in our DB)
ALTER TABLE places
ADD CONSTRAINT places_google_place_id_unique UNIQUE (google_place_id);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_places_google_place_id
ON places(google_place_id)
WHERE google_place_id IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN places.google_place_id IS 'Google Places API Place ID for linking to Google POI data';

-- Optional: Backfill existing data from JSONB providers field
-- This migrates any existing Google Place IDs stored in the raw JSONB format
UPDATE places
SET google_place_id = (raw->'providers'->'google'->>'externalId')
WHERE raw->'providers'->'google'->>'externalId' IS NOT NULL
  AND google_place_id IS NULL;
