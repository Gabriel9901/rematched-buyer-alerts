/**
 * Database Types
 *
 * These types match the Supabase schema for the buyer alerts app.
 */

export interface Buyer {
  id: string;
  name: string;
  slack_channel: string | null;
  created_at: string;
  updated_at: string;
}

export interface BuyerCriteria {
  id: string;
  buyer_id: string;
  name: string;
  is_active: boolean;

  // Search filters
  kind: 'listing' | 'client_request';
  transaction_type: 'sale' | 'rent';
  property_types: string[] | null;
  communities: string[] | null;
  developers: string[] | null;
  bedrooms: number[] | null;
  bathrooms: number[] | null;
  min_price_aed: number | null;
  max_price_aed: number | null;
  keywords: string | null;

  // Area filter
  min_area_sqft?: number | null;
  max_area_sqft?: number | null;

  // Location filter using PSL codes from propsearch.ae
  psl_codes?: string[] | null;

  // Boolean filters - null means don't filter
  is_off_plan?: boolean | null;
  is_distressed_deal?: boolean | null;  // "Below Market Deal"
  is_urgent?: boolean | null;
  is_direct?: boolean | null;
  has_maid_bedroom?: boolean | null;
  is_agent_covered?: boolean | null;
  is_commission_split?: boolean | null;
  is_mortgage_approved?: boolean | null;
  is_community_agnostic?: boolean | null;

  // String filters
  furnishing?: string[] | null;
  mortgage_or_cash?: string[] | null;

  // Date range filter
  date_from?: string | null;
  date_to?: string | null;

  // AI prompt for Gemini qualification
  ai_prompt?: string | null;

  // Query run tracking for temporal deduplication
  last_run_at?: string | null;

  created_at: string;
  updated_at: string;
}

export interface Match {
  id: string;
  criteria_id: string;
  listing_id: string;
  listing_data: Record<string, unknown>;
  relevance_score: number | null;
  qualification_notes: string | null;
  is_notified: boolean;
  notified_at: string | null;
  created_at: string;
}

// Insert types (without auto-generated fields)
export type BuyerInsert = Omit<Buyer, 'id' | 'created_at' | 'updated_at'>;
export type BuyerCriteriaInsert = Omit<BuyerCriteria, 'id' | 'created_at' | 'updated_at'>;
export type MatchInsert = Omit<Match, 'id' | 'created_at'>;

// Update types
export type BuyerUpdate = Partial<BuyerInsert>;
export type BuyerCriteriaUpdate = Partial<Omit<BuyerCriteriaInsert, 'buyer_id'>>;
export type MatchUpdate = Partial<Pick<Match, 'is_notified' | 'notified_at'>>;

// Join types for queries
export interface BuyerWithCriteria extends Buyer {
  criteria: BuyerCriteria[];
}

export interface CriteriaWithBuyer extends BuyerCriteria {
  buyer: Buyer;
}

export interface MatchWithDetails extends Match {
  criteria: CriteriaWithBuyer;
}
