/**
 * Typesense Search Types
 * Matches the Rematched inventory schema
 */

export interface Criteria {
  userId: string; // Required - exclude user's own listings
  q?: string; // Search query (default "*")
  kind?: 'listing' | 'client_request';
  transactionType?: 'sale' | 'rent';
  archived?: boolean; // Default false
  requireAgentContact?: boolean; // Default true
  maxPriceAed?: number;
  minPriceAed?: number;
  propertyTypes?: string[]; // apartment, villa, townhouse, office, land, retail, other
  communities?: string[];
  developers?: string[];
  bedrooms?: number[]; // 0=Studio, 1-5, 6+=6+
  bathrooms?: number[];

  // Area filter
  minAreaSqft?: number;
  maxAreaSqft?: number;

  // Location filter using PSL codes from propsearch.ae
  pslCodes?: string[];

  // Boolean filters - Yes/No/Don't care (undefined)
  isOffPlan?: boolean;
  isDistressedDeal?: boolean; // "Below Market Deal"
  isUrgent?: boolean;
  isDirect?: boolean;
  hasMaidBedroom?: boolean;
  isAgentCovered?: boolean;
  isCommissionSplit?: boolean;
  isMortgageApproved?: boolean;
  isCommunityAgnostic?: boolean;

  // String filters
  furnishing?: string[]; // furnished, unfurnished, semi-furnished
  mortgageOrCash?: string[]; // mortgage, cash

  // Date range filter
  dateFrom?: number; // Unix timestamp
  dateTo?: number; // Unix timestamp

  urgentSince?: number; // Unix seconds - for urgent query
  sinceDaysAgo?: number; // Filter to listings from last N days
  page?: number; // Default 1
  perPage?: number; // Default 50
}

export interface TypesenseSearch {
  collection: string;
  q: string;
  query_by: string;
  query_by_weights: string;
  highlight_full_fields: string;
  facet_by: string;
  filter_by: string;
  sort_by: string;
  num_typos: number;
  typo_tokens_threshold: number;
  drop_tokens_threshold: number;
  enable_overrides: boolean;
  snippet_threshold: number;
  limit_hits: number;
  page: number;
  per_page: number;
}

export interface MultiSearchBody {
  searches: TypesenseSearch[];
}

export interface TypesenseHit {
  document: {
    id: string;
    user_id: string;
    source: string;
    source_timestamp: number;
    archived: boolean;
    has_agent_phone: boolean;
    has_agent_username: boolean;
    data: {
      kind: string;
      transaction_type: string;
      property_type: string;
      community: string;
      developer: string;
      bedrooms: number;
      bathrooms: number;
      price_aed: number;
      area_sqft: number;
      location_raw: string;
      message_body_clean: string;
      other_details: string;
      is_urgent: boolean;
      is_off_plan: boolean;
      is_direct: boolean;
      furnishing: string;
    };
    contact?: {
      phone?: string;
      username?: string;
      name?: string;
    };
  };
  highlights: Array<{
    field: string;
    snippet: string;
  }>;
}

export interface TypesenseSearchResult {
  found: number;
  hits: TypesenseHit[];
  facet_counts: Array<{
    field_name: string;
    counts: Array<{
      value: string;
      count: number;
    }>;
  }>;
}

export interface MultiSearchResult {
  results: TypesenseSearchResult[];
}
