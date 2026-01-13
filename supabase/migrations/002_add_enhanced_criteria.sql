-- Migration: Add enhanced buyer criteria fields
-- Run this in your Supabase SQL editor

-- Area range filters
ALTER TABLE buyer_criteria ADD COLUMN IF NOT EXISTS min_area_sqft INTEGER;
ALTER TABLE buyer_criteria ADD COLUMN IF NOT EXISTS max_area_sqft INTEGER;

-- PSL codes for location filtering (more reliable than community names)
ALTER TABLE buyer_criteria ADD COLUMN IF NOT EXISTS psl_codes TEXT[];

-- AI qualification prompt for Gemini
ALTER TABLE buyer_criteria ADD COLUMN IF NOT EXISTS ai_prompt TEXT;

-- Boolean filters (null = don't filter)
ALTER TABLE buyer_criteria ADD COLUMN IF NOT EXISTS is_off_plan BOOLEAN;
ALTER TABLE buyer_criteria ADD COLUMN IF NOT EXISTS is_distressed_deal BOOLEAN;
ALTER TABLE buyer_criteria ADD COLUMN IF NOT EXISTS is_urgent BOOLEAN;
ALTER TABLE buyer_criteria ADD COLUMN IF NOT EXISTS is_direct BOOLEAN;
ALTER TABLE buyer_criteria ADD COLUMN IF NOT EXISTS has_maid_bedroom BOOLEAN;
ALTER TABLE buyer_criteria ADD COLUMN IF NOT EXISTS is_agent_covered BOOLEAN;
ALTER TABLE buyer_criteria ADD COLUMN IF NOT EXISTS is_commission_split BOOLEAN;
ALTER TABLE buyer_criteria ADD COLUMN IF NOT EXISTS is_mortgage_approved BOOLEAN;
ALTER TABLE buyer_criteria ADD COLUMN IF NOT EXISTS is_community_agnostic BOOLEAN;

-- String array filters
ALTER TABLE buyer_criteria ADD COLUMN IF NOT EXISTS furnishing TEXT[];
ALTER TABLE buyer_criteria ADD COLUMN IF NOT EXISTS mortgage_or_cash TEXT[];

-- Date range filters
ALTER TABLE buyer_criteria ADD COLUMN IF NOT EXISTS date_from TIMESTAMPTZ;
ALTER TABLE buyer_criteria ADD COLUMN IF NOT EXISTS date_to TIMESTAMPTZ;

-- Add comments for documentation
COMMENT ON COLUMN buyer_criteria.psl_codes IS 'PSL codes from Typesense location_data for precise location filtering';
COMMENT ON COLUMN buyer_criteria.ai_prompt IS 'Custom prompt sent to Gemini AI for qualification scoring';
COMMENT ON COLUMN buyer_criteria.is_distressed_deal IS 'Below Market Deal filter';
COMMENT ON COLUMN buyer_criteria.min_area_sqft IS 'Minimum area in square feet';
COMMENT ON COLUMN buyer_criteria.max_area_sqft IS 'Maximum area in square feet';
