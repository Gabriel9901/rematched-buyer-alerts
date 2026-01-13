-- Migration: Add new filter columns to buyer_criteria table
-- Run this in Supabase SQL Editor to add the new columns

-- Area filter columns
ALTER TABLE buyer_criteria ADD COLUMN IF NOT EXISTS min_area_sqft INT;
ALTER TABLE buyer_criteria ADD COLUMN IF NOT EXISTS max_area_sqft INT;

-- Location filter using PSL codes
ALTER TABLE buyer_criteria ADD COLUMN IF NOT EXISTS psl_codes TEXT[];

-- Boolean filters
ALTER TABLE buyer_criteria ADD COLUMN IF NOT EXISTS is_off_plan BOOLEAN;
ALTER TABLE buyer_criteria ADD COLUMN IF NOT EXISTS is_distressed_deal BOOLEAN;
ALTER TABLE buyer_criteria ADD COLUMN IF NOT EXISTS is_urgent BOOLEAN;
ALTER TABLE buyer_criteria ADD COLUMN IF NOT EXISTS is_direct BOOLEAN;
ALTER TABLE buyer_criteria ADD COLUMN IF NOT EXISTS has_maid_bedroom BOOLEAN;
ALTER TABLE buyer_criteria ADD COLUMN IF NOT EXISTS is_agent_covered BOOLEAN;
ALTER TABLE buyer_criteria ADD COLUMN IF NOT EXISTS is_commission_split BOOLEAN;
ALTER TABLE buyer_criteria ADD COLUMN IF NOT EXISTS is_mortgage_approved BOOLEAN;
ALTER TABLE buyer_criteria ADD COLUMN IF NOT EXISTS is_community_agnostic BOOLEAN;

-- String filters
ALTER TABLE buyer_criteria ADD COLUMN IF NOT EXISTS furnishing TEXT[];
ALTER TABLE buyer_criteria ADD COLUMN IF NOT EXISTS mortgage_or_cash TEXT[];

-- Date range filter
ALTER TABLE buyer_criteria ADD COLUMN IF NOT EXISTS date_from TIMESTAMPTZ;
ALTER TABLE buyer_criteria ADD COLUMN IF NOT EXISTS date_to TIMESTAMPTZ;

-- Verify columns were added
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'buyer_criteria'
ORDER BY ordinal_position;
