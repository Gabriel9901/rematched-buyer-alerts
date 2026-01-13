-- Migration: Add last_run_at timestamp for temporal query deduplication
-- Run this in your Supabase SQL editor

-- Track when each criteria was last queried
-- Used to only search for new listings since the last run
ALTER TABLE buyer_criteria ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ;

-- Add comment for documentation
COMMENT ON COLUMN buyer_criteria.last_run_at IS 'Timestamp of the last successful search query run for this criteria. Used for temporal deduplication to only fetch new listings.';

-- Index for efficient querying of criteria by last run time
CREATE INDEX IF NOT EXISTS idx_buyer_criteria_last_run_at ON buyer_criteria(last_run_at);
