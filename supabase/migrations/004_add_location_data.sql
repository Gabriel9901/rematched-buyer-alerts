-- Migration: Add location_data JSONB column for storing full location objects
-- This allows displaying location names when editing criteria (instead of just PSL codes)
-- Run this in your Supabase SQL editor

-- Store full location data: [{name, pslCode, address}, ...]
ALTER TABLE buyer_criteria ADD COLUMN IF NOT EXISTS location_data JSONB;

-- Add comment for documentation
COMMENT ON COLUMN buyer_criteria.location_data IS 'Full location objects [{name, pslCode, address}] for UI display. PSL codes remain authoritative for search.';
