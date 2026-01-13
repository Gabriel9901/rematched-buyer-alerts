-- Migration: Add system prompts for AI qualification
-- Run this in your Supabase SQL editor

-- =============================================================================
-- APP SETTINGS TABLE
-- =============================================================================
-- Stores application-wide settings including the default system prompt

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add trigger for updated_at
DROP TRIGGER IF EXISTS update_app_settings_updated_at ON app_settings;
CREATE TRIGGER update_app_settings_updated_at
  BEFORE UPDATE ON app_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- BUYER SYSTEM PROMPT
-- =============================================================================
-- Add optional system_prompt column to buyers table
-- When NULL, uses the default from app_settings

ALTER TABLE buyers ADD COLUMN IF NOT EXISTS system_prompt TEXT;

COMMENT ON COLUMN buyers.system_prompt IS 'Custom AI system prompt for this buyer. When NULL, uses the global default from app_settings.';

-- =============================================================================
-- INSERT DEFAULT SYSTEM PROMPT
-- =============================================================================
-- This is the default prompt with granular placeholders

INSERT INTO app_settings (key, value) VALUES (
  'default_system_prompt',
  jsonb_build_object(
    'template', 'You are a real estate matching assistant. Analyze how well this property listing matches the buyer''s requirements.

BUYER REQUIREMENTS:
- Search Name: {search_name}
- Property Types: {property_types}
- Target Communities: {communities}
- Preferred Developers: {developers}
- Bedrooms: {bedrooms}
- Bathrooms: {bathrooms}
- Price Range: {price_range}
- Area Range: {area_range}
- Keywords: {keywords}
{additional_notes}

PROPERTY LISTING:
- Type: {listing_type}
- Transaction: {listing_transaction}
- Location: {listing_location}
- Developer: {listing_developer}
- Bedrooms: {listing_bedrooms}
- Bathrooms: {listing_bathrooms}
- Price: {listing_price}
- Area: {listing_area}
- Furnishing: {listing_furnishing}
- Off-Plan: {listing_is_off_plan}
- Urgent: {listing_is_urgent}
- Description: {listing_description}

Evaluate the match and respond with ONLY a JSON object in this exact format:
{
  "score": <number 0-100>,
  "explanation": "<brief 1-2 sentence summary>",
  "highlights": ["<matching point 1>", "<matching point 2>"],
  "concerns": ["<potential issue 1>", "<potential issue 2>"]
}

Scoring guide:
- 90-100: Perfect match on all criteria
- 70-89: Good match, minor deviations
- 50-69: Partial match, some criteria not met
- 30-49: Weak match, significant mismatches
- 0-29: Poor match, most criteria not met

Be strict but fair. Only include real highlights and concerns.',
    'version', 1
  )
) ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();

-- =============================================================================
-- AVAILABLE PLACEHOLDERS DOCUMENTATION
-- =============================================================================
-- Store placeholder documentation as a reference

INSERT INTO app_settings (key, value) VALUES (
  'system_prompt_placeholders',
  jsonb_build_object(
    'buyer_requirements', jsonb_build_array(
      jsonb_build_object('name', '{search_name}', 'description', 'Name of the search criteria'),
      jsonb_build_object('name', '{property_types}', 'description', 'Property types (apartment, villa, etc.)'),
      jsonb_build_object('name', '{communities}', 'description', 'Target communities/locations'),
      jsonb_build_object('name', '{developers}', 'description', 'Preferred developers'),
      jsonb_build_object('name', '{bedrooms}', 'description', 'Number of bedrooms'),
      jsonb_build_object('name', '{bathrooms}', 'description', 'Number of bathrooms'),
      jsonb_build_object('name', '{price_range}', 'description', 'Price range in AED'),
      jsonb_build_object('name', '{area_range}', 'description', 'Area range in sqft'),
      jsonb_build_object('name', '{keywords}', 'description', 'Search keywords'),
      jsonb_build_object('name', '{additional_notes}', 'description', 'Custom qualification criteria from ai_prompt field')
    ),
    'listing_data', jsonb_build_array(
      jsonb_build_object('name', '{listing_type}', 'description', 'Property type'),
      jsonb_build_object('name', '{listing_transaction}', 'description', 'Transaction type (sale/rent)'),
      jsonb_build_object('name', '{listing_location}', 'description', 'Property location'),
      jsonb_build_object('name', '{listing_developer}', 'description', 'Developer name'),
      jsonb_build_object('name', '{listing_bedrooms}', 'description', 'Number of bedrooms'),
      jsonb_build_object('name', '{listing_bathrooms}', 'description', 'Number of bathrooms'),
      jsonb_build_object('name', '{listing_price}', 'description', 'Property price'),
      jsonb_build_object('name', '{listing_area}', 'description', 'Area in sqft'),
      jsonb_build_object('name', '{listing_furnishing}', 'description', 'Furnishing status'),
      jsonb_build_object('name', '{listing_is_off_plan}', 'description', 'Is off-plan property'),
      jsonb_build_object('name', '{listing_is_urgent}', 'description', 'Is urgent listing'),
      jsonb_build_object('name', '{listing_description}', 'description', 'Full listing description')
    )
  )
) ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
