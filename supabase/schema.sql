-- Rematched Buyer Alerts Schema
-- Run this in the Supabase SQL Editor to create all tables

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- BUYERS TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS buyers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slack_channel TEXT,  -- Optional Slack channel/user for notifications
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for listing buyers
CREATE INDEX IF NOT EXISTS idx_buyers_created_at ON buyers(created_at DESC);

-- =============================================================================
-- BUYER CRITERIA TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS buyer_criteria (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  buyer_id UUID NOT NULL REFERENCES buyers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,  -- e.g., "2BR Apartments in Dubai Marina"
  is_active BOOLEAN DEFAULT true,

  -- Search filters (matching Typesense schema)
  kind TEXT DEFAULT 'listing' CHECK (kind IN ('listing', 'client_request')),
  transaction_type TEXT DEFAULT 'sale' CHECK (transaction_type IN ('sale', 'rent')),
  property_types TEXT[],  -- apartment, villa, townhouse, office, land, retail, other
  communities TEXT[],
  developers TEXT[],
  bedrooms INT[],  -- 0=Studio, 1-5, 6=6+
  bathrooms INT[],
  min_price_aed INT,
  max_price_aed INT,
  keywords TEXT,  -- Free text search (q parameter)

  -- Area filter
  min_area_sqft INT,
  max_area_sqft INT,

  -- Location filter using PSL codes from propsearch.ae
  psl_codes TEXT[],

  -- Boolean filters - NULL means don't filter
  is_off_plan BOOLEAN,  -- Yes/No/Don't care
  is_distressed_deal BOOLEAN,  -- "Below Market Deal"
  is_urgent BOOLEAN,
  is_direct BOOLEAN,
  has_maid_bedroom BOOLEAN,
  is_agent_covered BOOLEAN,
  is_commission_split BOOLEAN,
  is_mortgage_approved BOOLEAN,
  is_community_agnostic BOOLEAN,

  -- String filters
  furnishing TEXT[],  -- furnished, unfurnished, semi-furnished
  mortgage_or_cash TEXT[],  -- mortgage, cash

  -- Date range filter
  date_from TIMESTAMPTZ,
  date_to TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for criteria
CREATE INDEX IF NOT EXISTS idx_buyer_criteria_buyer_id ON buyer_criteria(buyer_id);
CREATE INDEX IF NOT EXISTS idx_buyer_criteria_is_active ON buyer_criteria(is_active) WHERE is_active = true;

-- =============================================================================
-- MATCHES TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS matches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  criteria_id UUID NOT NULL REFERENCES buyer_criteria(id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL,  -- Typesense document ID

  -- Cached listing data for display
  listing_data JSONB NOT NULL,

  -- Gemini qualification
  relevance_score FLOAT,  -- 0-100 score from Gemini
  qualification_notes TEXT,  -- Gemini explanation

  -- Status
  is_notified BOOLEAN DEFAULT false,
  notified_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Prevent duplicate matches
  UNIQUE(criteria_id, listing_id)
);

-- Indexes for matches
CREATE INDEX IF NOT EXISTS idx_matches_criteria_id ON matches(criteria_id);
CREATE INDEX IF NOT EXISTS idx_matches_created_at ON matches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_matches_is_notified ON matches(is_notified) WHERE is_notified = false;
CREATE INDEX IF NOT EXISTS idx_matches_relevance_score ON matches(relevance_score DESC) WHERE relevance_score IS NOT NULL;

-- =============================================================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================================================
-- For this personal app, we disable RLS since there's no multi-user auth
-- If you add auth later, uncomment and modify these policies

-- ALTER TABLE buyers ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE buyer_criteria ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE matches ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY "Allow all for authenticated users" ON buyers FOR ALL USING (true);
-- CREATE POLICY "Allow all for authenticated users" ON buyer_criteria FOR ALL USING (true);
-- CREATE POLICY "Allow all for authenticated users" ON matches FOR ALL USING (true);

-- =============================================================================
-- UPDATED_AT TRIGGER
-- =============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to tables with updated_at
DROP TRIGGER IF EXISTS update_buyers_updated_at ON buyers;
CREATE TRIGGER update_buyers_updated_at
  BEFORE UPDATE ON buyers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_buyer_criteria_updated_at ON buyer_criteria;
CREATE TRIGGER update_buyer_criteria_updated_at
  BEFORE UPDATE ON buyer_criteria
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- SAMPLE DATA (Optional - uncomment to test)
-- =============================================================================
/*
-- Insert a test buyer
INSERT INTO buyers (name, slack_channel) VALUES
  ('Test Buyer', '#real-estate-alerts');

-- Insert test criteria
INSERT INTO buyer_criteria (
  buyer_id,
  name,
  kind,
  transaction_type,
  property_types,
  communities,
  bedrooms,
  min_price_aed,
  max_price_aed
)
SELECT
  id,
  '2BR Apartment in Dubai Marina',
  'listing',
  'sale',
  ARRAY['apartment'],
  ARRAY['Dubai Marina', 'JBR'],
  ARRAY[2],
  1000000,
  2500000
FROM buyers
WHERE name = 'Test Buyer';
*/
