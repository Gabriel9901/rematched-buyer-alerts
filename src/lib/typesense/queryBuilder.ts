/**
 * Typesense Query Builder
 *
 * SECURITY: All inputs are sanitized before being inserted into filter_by.
 * Never accepts raw filter fragments. Prevents filter injection attacks.
 *
 * NOTE: The "_eval" in sort_by is Typesense's sort expression syntax,
 * not JavaScript's eval(). It's a safe, server-side Typesense feature.
 */

import { Criteria, TypesenseSearch, MultiSearchBody } from './types';

// =============================================================================
// SANITIZERS - Must be used for ANY string inserted into filter_by
// =============================================================================

/**
 * Sanitize a token for use in filter_by.
 * Only allows: a-zA-Z0-9_:- and strips everything else.
 * Throws if result is empty.
 */
export function sanitizeToken(str: string): string {
  if (typeof str !== 'string') {
    throw new Error('sanitizeToken: input must be a string');
  }
  const sanitized = str.replace(/[^a-zA-Z0-9_:\-]/g, '');
  if (sanitized.length === 0) {
    throw new Error('sanitizeToken: result is empty after sanitization');
  }
  return sanitized;
}

/**
 * Sanitize a list of enum values.
 * Maps sanitizeToken over list, drops empties.
 * Throws if list was provided but result is empty.
 */
export function sanitizeEnumList(list: string[]): string[] {
  if (!Array.isArray(list)) {
    throw new Error('sanitizeEnumList: input must be an array');
  }
  const sanitized = list
    .map((item) => {
      try {
        return sanitizeToken(item);
      } catch {
        return '';
      }
    })
    .filter((item) => item.length > 0);

  if (list.length > 0 && sanitized.length === 0) {
    throw new Error('sanitizeEnumList: all items were invalid');
  }
  return sanitized;
}

/**
 * Sanitize a number - ensure it's finite.
 */
export function sanitizeNumber(n: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new Error('sanitizeNumber: input must be a finite number');
  }
  return n;
}

/**
 * Sanitize a PSL code for use in location filter.
 * PSL codes are like PSLGKY6W3Y - alphanumeric only.
 */
export function sanitizePslCode(code: string): string {
  if (typeof code !== 'string') {
    throw new Error('sanitizePslCode: input must be a string');
  }
  const sanitized = code.replace(/[^a-zA-Z0-9]/g, '');
  if (sanitized.length === 0) {
    throw new Error('sanitizePslCode: result is empty after sanitization');
  }
  return sanitized;
}

/**
 * Convert a sanitized list to Typesense list format: [a,b,c]
 * Input list must already be sanitized.
 */
export function toTypesenseList(list: string[] | number[]): string {
  if (list.length === 0) {
    throw new Error('toTypesenseList: list cannot be empty');
  }
  return `[${list.join(',')}]`;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const QUERY_BY =
  'data.message_body_clean,data.kind,data.property_type,data.transaction_type,data.location_raw,data.community,data.developer,data.other_details';

const QUERY_BY_WEIGHTS = '5,5,4,4,3,3,2,1';

const HIGHLIGHT_FIELDS =
  'data.location_raw,data.community,data.developer,data.message_body_clean,data.other_details';

const FACET_BY = [
  'data.kind',
  'data.property_type',
  'data.transaction_type',
  'data.community',
  'data.developer',
  'data.bedrooms',
  'data.bathrooms',
  'data.furnishing',
  'data.has_maid_bedroom',
  'data.is_direct',
  'data.is_urgent',
  'data.is_off_plan',
  'data.is_agent_covered',
  'data.mortgage_or_cash',
  'data.is_distressed_deal',
  'data.is_commission_split',
  'data.is_mortgage_approved',
  'data.is_community_agnostic',
  'data.area_sqft',
  'data.area_sqft_null',
  'data.price_aed',
  'data.price_aed_null',
  'data.budget_max_aed',
  'data.budget_min_aed',
  'data.budget_max_aed_null',
  'data.budget_min_aed_null',
  'data.is_direct_null',
  'data.is_urgent_null',
  'data.is_off_plan_null',
  'data.has_maid_bedroom_null',
  'data.is_agent_covered_null',
  'data.is_distressed_deal_null',
  'data.is_commission_split_null',
  'data.is_mortgage_approved_null',
  'data.is_community_agnostic_null',
].join(',');

// Typesense sort expression - uses Typesense's server-side expression syntax
// This is NOT JavaScript eval - it's a safe Typesense feature
const MAIN_SORT_BY =
  'source_timestamp_group:desc,_eval([ (source:=[app,xml]):2, (source:=[whatsapp,telegram]):1 ]):desc,source_timestamp:desc';

// Default max price for listings (matches ReMatch app behavior)
// This serves two purposes:
// 1. Sanity ceiling (no listing costs 200M AED)
// 2. Excludes listings with null price_aed (Typesense <= filter fails on null)
const DEFAULT_MAX_PRICE_AED = 200_000_000;

// =============================================================================
// FILTER BUILDER
// =============================================================================

interface FilterOptions {
  urgentOnly?: boolean;
  includeUrgentSince?: boolean;
}

/**
 * Build filter_by string from criteria.
 * All values are sanitized before being inserted.
 */
export function buildFilterBy(criteria: Criteria, opts: FilterOptions = {}): string {
  const clauses: string[] = [];

  // Kind (default: listing)
  const kind = criteria.kind ?? 'listing';
  clauses.push(`data.kind:=${sanitizeToken(kind)}`);

  // Transaction type (default: sale)
  const transactionType = criteria.transactionType ?? 'sale';
  clauses.push(`data.transaction_type:=${sanitizeToken(transactionType)}`);

  // Archived (default: false)
  const archived = criteria.archived ?? false;
  clauses.push(`archived:=${archived}`);

  // Agent contact requirement (default: true)
  const requireAgent = criteria.requireAgentContact ?? true;
  if (requireAgent) {
    clauses.push('(has_agent_phone:=true || has_agent_username:=true)');
  }

  // Price filters
  // For listings: apply default max price if none specified (matches ReMatch behavior)
  // This also excludes listings with null price_aed since Typesense <= fails on null
  if (criteria.maxPriceAed !== undefined) {
    clauses.push(`data.price_aed:<=${sanitizeNumber(criteria.maxPriceAed)}`);
  } else if (kind === 'listing') {
    // Default max price for listings - excludes null prices and acts as sanity ceiling
    clauses.push(`data.price_aed:<=${DEFAULT_MAX_PRICE_AED}`);
  }
  if (criteria.minPriceAed !== undefined) {
    clauses.push(`data.price_aed:>=${sanitizeNumber(criteria.minPriceAed)}`);
  }

  // Area filters
  if (criteria.maxAreaSqft !== undefined) {
    clauses.push(`data.area_sqft:<=${sanitizeNumber(criteria.maxAreaSqft)}`);
  }
  if (criteria.minAreaSqft !== undefined) {
    clauses.push(`data.area_sqft:>=${sanitizeNumber(criteria.minAreaSqft)}`);
  }

  // Property types
  if (criteria.propertyTypes && criteria.propertyTypes.length > 0) {
    const sanitized = sanitizeEnumList(criteria.propertyTypes);
    clauses.push(`data.property_type:=${toTypesenseList(sanitized)}`);
  }

  // Communities - ONLY use if PSL codes are NOT provided
  // PSL codes are more reliable as community field is often empty ("~~")
  if (criteria.communities && criteria.communities.length > 0 &&
      (!criteria.pslCodes || criteria.pslCodes.length === 0)) {
    const sanitized = sanitizeEnumList(criteria.communities);
    clauses.push(`data.community:=${toTypesenseList(sanitized)}`);
  }

  // Developers
  if (criteria.developers && criteria.developers.length > 0) {
    const sanitized = sanitizeEnumList(criteria.developers);
    clauses.push(`data.developer:=${toTypesenseList(sanitized)}`);
  }

  // PSL location codes (from propsearch.ae)
  // Uses nested object filter syntax: location_data.{address_psl_code:*CODE*}
  if (criteria.pslCodes && criteria.pslCodes.length > 0) {
    const pslClauses = criteria.pslCodes
      .map((code) => {
        try {
          const sanitized = sanitizePslCode(code);
          return `location_data.{address_psl_code:*${sanitized}*}`;
        } catch {
          return null;
        }
      })
      .filter((c): c is string => c !== null);

    if (pslClauses.length > 0) {
      clauses.push(`(${pslClauses.join(' || ')})`);
    }
  }

  // Bedrooms
  if (criteria.bedrooms && criteria.bedrooms.length > 0) {
    const sanitized = criteria.bedrooms.map(sanitizeNumber);
    clauses.push(`data.bedrooms:=${toTypesenseList(sanitized)}`);
  }

  // Bathrooms
  if (criteria.bathrooms && criteria.bathrooms.length > 0) {
    const sanitized = criteria.bathrooms.map(sanitizeNumber);
    clauses.push(`data.bathrooms:=${toTypesenseList(sanitized)}`);
  }

  // Furnishing
  if (criteria.furnishing && criteria.furnishing.length > 0) {
    const sanitized = sanitizeEnumList(criteria.furnishing);
    clauses.push(`data.furnishing:=${toTypesenseList(sanitized)}`);
  }

  // Mortgage or Cash
  if (criteria.mortgageOrCash && criteria.mortgageOrCash.length > 0) {
    const sanitized = sanitizeEnumList(criteria.mortgageOrCash);
    clauses.push(`data.mortgage_or_cash:=${toTypesenseList(sanitized)}`);
  }

  // Boolean filters - only add if explicitly set (undefined = don't care)
  if (criteria.isOffPlan !== undefined) {
    clauses.push(`data.is_off_plan:=${criteria.isOffPlan}`);
  }
  if (criteria.isDistressedDeal !== undefined) {
    clauses.push(`data.is_distressed_deal:=${criteria.isDistressedDeal}`);
  }
  if (criteria.isDirect !== undefined) {
    clauses.push(`data.is_direct:=${criteria.isDirect}`);
  }
  if (criteria.hasMaidBedroom !== undefined) {
    clauses.push(`data.has_maid_bedroom:=${criteria.hasMaidBedroom}`);
  }
  if (criteria.isAgentCovered !== undefined) {
    clauses.push(`data.is_agent_covered:=${criteria.isAgentCovered}`);
  }
  if (criteria.isCommissionSplit !== undefined) {
    clauses.push(`data.is_commission_split:=${criteria.isCommissionSplit}`);
  }
  if (criteria.isMortgageApproved !== undefined) {
    clauses.push(`data.is_mortgage_approved:=${criteria.isMortgageApproved}`);
  }
  if (criteria.isCommunityAgnostic !== undefined) {
    clauses.push(`data.is_community_agnostic:=${criteria.isCommunityAgnostic}`);
  }

  // Keyword filter on message body (matches ReMatch app behavior)
  // Uses wildcard contains filter instead of q parameter for more precise matching
  if (criteria.q && criteria.q !== '*') {
    // Sanitize keyword - allow only alphanumeric for safety
    const keyword = criteria.q.replace(/[^a-zA-Z0-9]/g, '');
    if (keyword.length > 0) {
      clauses.push(`(data.message_body_clean:*${keyword}*)`);
    }
  }

  // Date range filters
  if (criteria.dateFrom !== undefined) {
    clauses.push(`source_timestamp:>=${sanitizeNumber(criteria.dateFrom)}`);
  }
  if (criteria.dateTo !== undefined) {
    clauses.push(`source_timestamp:<=${sanitizeNumber(criteria.dateTo)}`);
  }

  // Time filter - for daily runs, only get listings from last N days
  // This is overridden by dateFrom if both are specified
  if (criteria.sinceDaysAgo !== undefined && criteria.dateFrom === undefined) {
    const daysAgo = sanitizeNumber(criteria.sinceDaysAgo);
    const sinceTimestamp = Math.floor(Date.now() / 1000) - daysAgo * 24 * 60 * 60;
    clauses.push(`source_timestamp:>=${sinceTimestamp}`);
  }

  // Urgent options
  if (opts.urgentOnly || criteria.isUrgent === true) {
    clauses.push('data.is_urgent:=true');
  }
  if (opts.includeUrgentSince && criteria.urgentSince !== undefined) {
    clauses.push(`source_timestamp:>=${sanitizeNumber(criteria.urgentSince)}`);
  }

  // User exclusion - ALWAYS applied
  clauses.push(`user_id:!=${sanitizeToken(criteria.userId)}`);

  return clauses.join(' && ');
}

// =============================================================================
// SEARCH BUILDERS
// =============================================================================

/**
 * Base search object with common settings
 * NOTE: q is always '*' because keywords are handled via filter_by on message_body_clean
 * This matches ReMatch app behavior and provides more precise keyword matching
 */
function buildBaseSearch(criteria: Criteria): Omit<TypesenseSearch, 'filter_by' | 'sort_by' | 'per_page'> {
  return {
    collection: 'unit',
    q: '*', // Keywords go in filter_by, not q (matches ReMatch)
    query_by: QUERY_BY,
    query_by_weights: QUERY_BY_WEIGHTS,
    highlight_full_fields: HIGHLIGHT_FIELDS,
    facet_by: FACET_BY,
    num_typos: 2,
    typo_tokens_threshold: 1,
    drop_tokens_threshold: 1,
    enable_overrides: true,
    snippet_threshold: 30,
    limit_hits: 1000,
    page: criteria.page ?? 1,
  };
}

/**
 * Build the main search query
 * - Full results with pagination
 * - Complex sort by timestamp group, source priority, then timestamp
 */
export function buildMainSearch(criteria: Criteria): TypesenseSearch {
  return {
    ...buildBaseSearch(criteria),
    per_page: criteria.perPage ?? 50,
    sort_by: MAIN_SORT_BY,
    filter_by: buildFilterBy(criteria, { urgentOnly: false }),
  };
}

/**
 * Build the urgent search query
 * - per_page: 0 (just counting)
 * - Filters for urgent listings only
 * - Simple timestamp sort
 */
export function buildUrgentSearch(criteria: Criteria): TypesenseSearch {
  return {
    ...buildBaseSearch(criteria),
    per_page: 0,
    sort_by: 'source_timestamp:desc',
    filter_by: buildFilterBy(criteria, { urgentOnly: true, includeUrgentSince: true }),
  };
}

/**
 * Build the complete multi_search body
 * Returns both main and urgent searches
 */
export function buildMultiSearchBody(criteria: Criteria): MultiSearchBody {
  return {
    searches: [buildMainSearch(criteria), buildUrgentSearch(criteria)],
  };
}

/**
 * Build a simple search (main only, no urgent count)
 * Use this for the daily cron job
 */
export function buildSimpleSearchBody(criteria: Criteria): MultiSearchBody {
  return {
    searches: [buildMainSearch(criteria)],
  };
}
