/**
 * Text-to-Filters Parser
 *
 * Parses natural language buyer requirements into structured criteria
 * using Gemini AI, with validation and normalization.
 */

import { callGeminiJson, callGeminiMultimodalJson } from '@/lib/gemini/client';

// Valid values for enum fields - includes Dubai-specific property types
const VALID_PROPERTY_TYPES = [
  'apartment',
  'villa',
  'townhouse',
  'penthouse',
  'duplex',
  'office',
  'land',
  'retail',
  'shop',
  'showroom',
  'warehouse',
  'labor_camp',      // Staff/worker accommodation
  'staff_accommodation',
  'full_floor',
  'half_floor',
  'bulk_unit',
  'building',
  'hotel_apartment',
  'other',
];
const VALID_FURNISHING = ['furnished', 'unfurnished', 'semi-furnished'];
const VALID_MORTGAGE_OR_CASH = ['mortgage', 'cash'];

/**
 * Output schema from Gemini parsing
 */
export interface ParsedCriteria {
  transaction_type: 'sale' | 'rent';
  property_types: string[];
  bedrooms: number[];
  bathrooms: number[];
  min_price_aed: number | null;
  max_price_aed: number | null;
  min_area_sqft: number | null;
  max_area_sqft: number | null;
  furnishing: string[];
  // Boolean filters
  is_off_plan: boolean | null;
  is_distressed_deal: boolean | null;
  is_urgent: boolean | null;
  is_direct: boolean | null;
  has_maid_bedroom: boolean | null;
  is_agent_covered: boolean | null;
  is_commission_split: boolean | null;
  is_mortgage_approved: boolean | null;
  is_community_agnostic: boolean | null;
  // String array filters
  mortgage_or_cash: string[];
  keywords: string[];
  // Other fields
  location_names: string[];
  ai_prompt: string;
}

export interface ParseResult {
  parsed: ParsedCriteria;
  confidence: number;
  warnings: string[];
}

/**
 * Extended criteria with a name field for multi-criteria extraction
 */
export interface NamedParsedCriteria extends ParsedCriteria {
  name: string; // Auto-generated name for this search criteria
}

/**
 * Result from parsing a file that may contain multiple buyer profiles
 */
export interface MultiParseResult {
  criteria: Array<{
    parsed: NamedParsedCriteria;
    confidence: number;
  }>;
  warnings: string[];
}

/**
 * Build the Gemini prompt for structured extraction
 */
export function buildParsePrompt(text: string): string {
  return `You are a Dubai real estate search criteria parser. Parse buyer requirements into structured filters.

INPUT TEXT:
"${text}"

OUTPUT: Valid JSON matching this exact schema:
{
  "transaction_type": "sale" or "rent" (default "sale" if not specified),
  "property_types": ["apartment", "villa", "townhouse", "penthouse", "duplex", "office", "land", "retail", "shop", "showroom", "warehouse", "labor_camp", "staff_accommodation", "full_floor", "half_floor", "bulk_unit", "building", "hotel_apartment", "other"],
  "bedrooms": [array of integers, 0=studio],
  "bathrooms": [array of integers] or [],
  "min_price_aed": number or null,
  "max_price_aed": number or null,
  "min_area_sqft": number or null,
  "max_area_sqft": number or null,
  "furnishing": ["furnished", "unfurnished", "semi-furnished"] or [],
  "is_off_plan": true/false/null (only set if explicitly mentioned),
  "is_distressed_deal": true/false/null (below market deals),
  "is_urgent": true/false/null,
  "is_direct": true/false/null (direct from owner),
  "has_maid_bedroom": true/false/null (if maid's room mentioned),
  "is_agent_covered": true/false/null (if agent fee covered by seller),
  "is_commission_split": true/false/null (if commission split mentioned),
  "is_mortgage_approved": true/false/null (if buyer is mortgage pre-approved),
  "is_community_agnostic": true/false/null (if buyer is flexible on location),
  "mortgage_or_cash": ["mortgage", "cash"] or [] (payment method preference),
  "keywords": ["keyword1", "keyword2"] or [] (specific searchable features),
  "location_names": ["Dubai Marina", "JBR", etc - extract area/community names],
  "ai_prompt": "Requirements that can't be mapped to fields above - things like 'sea view', 'high floor', 'upgraded kitchen', 'corner unit', etc.",
  "confidence": 0-100 (how confident you are in the parsing)
}

PARSING RULES:
1. Dubai prices are in AED. Parse shorthand: "2M" = 2000000, "2.5M" = 2500000, "500K" = 500000
2. Area is typically in sqft. If sqm mentioned, convert: 1 sqm = 10.764 sqft
3. "Studio" = bedrooms: [0], "1BR" or "1 bedroom" = bedrooms: [1]
4. "1-3BR" means bedrooms: [1, 2, 3]
5. Default to "sale" unless rent/rental/lease is mentioned
6. For location_names, extract Dubai area names like: Dubai Marina, JBR, Downtown, Business Bay, Palm Jumeirah, JVC, JVT, etc.
7. Put qualitative requirements in ai_prompt: sea view, high floor, upgraded, corner unit, pool view, etc.
8. Only set boolean filters (is_off_plan, etc.) to true/false if EXPLICITLY mentioned, otherwise null
9. If text is too vague or unparseable, put everything in ai_prompt and set confidence low
10. "Maid's room", "maid bedroom", "helper's room" → has_maid_bedroom: true
11. "Agent covered", "seller pays agent" → is_agent_covered: true
12. "Commission split", "split commission" → is_commission_split: true
13. "Mortgage approved", "pre-approved", "finance ready" → is_mortgage_approved: true
14. "Flexible on location", "any area", "location flexible" → is_community_agnostic: true
15. "Cash buyer", "cash only", "cash deal" → mortgage_or_cash: ["cash"]
16. "Mortgage available", "can finance" → mortgage_or_cash: ["mortgage"]
17. Extract specific searchable feature keywords into keywords array (e.g., "Burj view", "upgraded", "corner unit")

IMPORTANT: Output ONLY the JSON object, no other text.`;
}

/**
 * Validate and normalize Gemini output
 */
export function validateAndNormalize(raw: unknown): { result: ParseResult; isValid: boolean } {
  const warnings: string[] = [];

  // Type guard for the raw response
  const data = raw as Record<string, unknown>;

  // Initialize with defaults
  const parsed: ParsedCriteria = {
    transaction_type: 'sale',
    property_types: [],
    bedrooms: [],
    bathrooms: [],
    min_price_aed: null,
    max_price_aed: null,
    min_area_sqft: null,
    max_area_sqft: null,
    furnishing: [],
    // Boolean filters
    is_off_plan: null,
    is_distressed_deal: null,
    is_urgent: null,
    is_direct: null,
    has_maid_bedroom: null,
    is_agent_covered: null,
    is_commission_split: null,
    is_mortgage_approved: null,
    is_community_agnostic: null,
    // String array filters
    mortgage_or_cash: [],
    keywords: [],
    // Other fields
    location_names: [],
    ai_prompt: '',
  };

  // Transaction type
  if (data.transaction_type === 'rent' || data.transaction_type === 'sale') {
    parsed.transaction_type = data.transaction_type;
  } else if (data.transaction_type) {
    warnings.push(`Invalid transaction_type "${data.transaction_type}", defaulting to sale`);
  }

  // Property types - filter to valid values
  if (Array.isArray(data.property_types)) {
    parsed.property_types = (data.property_types as string[])
      .filter(t => VALID_PROPERTY_TYPES.includes(t.toLowerCase()))
      .map(t => t.toLowerCase());

    const invalid = (data.property_types as string[]).filter(t => !VALID_PROPERTY_TYPES.includes(t.toLowerCase()));
    if (invalid.length > 0) {
      warnings.push(`Ignored invalid property types: ${invalid.join(', ')}`);
    }
  }

  // Bedrooms - convert to numbers
  if (Array.isArray(data.bedrooms)) {
    parsed.bedrooms = (data.bedrooms as unknown[])
      .map(b => typeof b === 'number' ? b : parseInt(String(b)))
      .filter(b => !isNaN(b) && b >= 0 && b <= 10);
  }

  // Bathrooms - convert to numbers
  if (Array.isArray(data.bathrooms)) {
    parsed.bathrooms = (data.bathrooms as unknown[])
      .map(b => typeof b === 'number' ? b : parseInt(String(b)))
      .filter(b => !isNaN(b) && b >= 0 && b <= 10);
  }

  // Price range
  parsed.min_price_aed = normalizePrice(data.min_price_aed);
  parsed.max_price_aed = normalizePrice(data.max_price_aed);

  // Validate price range
  if (parsed.min_price_aed && parsed.max_price_aed && parsed.min_price_aed > parsed.max_price_aed) {
    warnings.push('Min price > max price, swapping values');
    [parsed.min_price_aed, parsed.max_price_aed] = [parsed.max_price_aed, parsed.min_price_aed];
  }

  // Area range
  parsed.min_area_sqft = normalizeArea(data.min_area_sqft);
  parsed.max_area_sqft = normalizeArea(data.max_area_sqft);

  // Validate area range
  if (parsed.min_area_sqft && parsed.max_area_sqft && parsed.min_area_sqft > parsed.max_area_sqft) {
    warnings.push('Min area > max area, swapping values');
    [parsed.min_area_sqft, parsed.max_area_sqft] = [parsed.max_area_sqft, parsed.min_area_sqft];
  }

  // Furnishing - filter to valid values
  if (Array.isArray(data.furnishing)) {
    parsed.furnishing = (data.furnishing as string[])
      .filter(f => VALID_FURNISHING.includes(f.toLowerCase()))
      .map(f => f.toLowerCase());
  }

  // Boolean filters - strict type checking
  parsed.is_off_plan = normalizeBoolean(data.is_off_plan);
  parsed.is_distressed_deal = normalizeBoolean(data.is_distressed_deal);
  parsed.is_urgent = normalizeBoolean(data.is_urgent);
  parsed.is_direct = normalizeBoolean(data.is_direct);
  parsed.has_maid_bedroom = normalizeBoolean(data.has_maid_bedroom);
  parsed.is_agent_covered = normalizeBoolean(data.is_agent_covered);
  parsed.is_commission_split = normalizeBoolean(data.is_commission_split);
  parsed.is_mortgage_approved = normalizeBoolean(data.is_mortgage_approved);
  parsed.is_community_agnostic = normalizeBoolean(data.is_community_agnostic);

  // Mortgage or cash - filter to valid values
  if (Array.isArray(data.mortgage_or_cash)) {
    parsed.mortgage_or_cash = (data.mortgage_or_cash as string[])
      .filter(v => VALID_MORTGAGE_OR_CASH.includes(v.toLowerCase()))
      .map(v => v.toLowerCase());
  }

  // Keywords - keep as strings
  if (Array.isArray(data.keywords)) {
    parsed.keywords = (data.keywords as unknown[])
      .filter(k => typeof k === 'string' && k.trim().length > 0)
      .map(k => String(k).trim());
  }

  // Location names - keep as strings
  if (Array.isArray(data.location_names)) {
    parsed.location_names = (data.location_names as unknown[])
      .filter(l => typeof l === 'string' && l.trim().length > 0)
      .map(l => String(l).trim());
  }

  // AI prompt
  if (typeof data.ai_prompt === 'string') {
    parsed.ai_prompt = data.ai_prompt.trim();
  }

  // Confidence
  let confidence = 50; // Default medium confidence
  if (typeof data.confidence === 'number' && data.confidence >= 0 && data.confidence <= 100) {
    confidence = data.confidence;
  }

  return {
    result: {
      parsed,
      confidence,
      warnings,
    },
    isValid: warnings.length === 0,
  };
}

/**
 * Normalize price values (handle strings like "2M", "500K")
 */
function normalizePrice(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number') {
    return value > 0 ? Math.round(value) : null;
  }

  if (typeof value === 'string') {
    const str = value.toUpperCase().replace(/,/g, '').trim();

    // Handle shorthand: 2M, 2.5M, 500K
    const mMatch = str.match(/^([\d.]+)\s*M$/);
    if (mMatch) {
      return Math.round(parseFloat(mMatch[1]) * 1000000);
    }

    const kMatch = str.match(/^([\d.]+)\s*K$/);
    if (kMatch) {
      return Math.round(parseFloat(kMatch[1]) * 1000);
    }

    // Plain number
    const num = parseFloat(str);
    return !isNaN(num) && num > 0 ? Math.round(num) : null;
  }

  return null;
}

/**
 * Normalize area values (convert sqm to sqft if needed)
 */
function normalizeArea(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number') {
    return value > 0 ? Math.round(value) : null;
  }

  if (typeof value === 'string') {
    const num = parseFloat(value.replace(/,/g, ''));
    return !isNaN(num) && num > 0 ? Math.round(num) : null;
  }

  return null;
}

/**
 * Normalize boolean values (only accept explicit true/false)
 */
function normalizeBoolean(value: unknown): boolean | null {
  if (value === true) return true;
  if (value === false) return false;
  return null;
}

/**
 * Parse natural language text into structured criteria
 */
export async function parseTextToCriteria(text: string): Promise<ParseResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable not configured');
  }

  const prompt = buildParsePrompt(text);

  try {
    const raw = await callGeminiJson(apiKey, prompt);
    const { result } = validateAndNormalize(raw);
    return result;
  } catch (error) {
    console.error('Failed to parse text:', error);

    // Return fallback with everything in ai_prompt
    return {
      parsed: {
        transaction_type: 'sale',
        property_types: [],
        bedrooms: [],
        bathrooms: [],
        min_price_aed: null,
        max_price_aed: null,
        min_area_sqft: null,
        max_area_sqft: null,
        furnishing: [],
        is_off_plan: null,
        is_distressed_deal: null,
        is_urgent: null,
        is_direct: null,
        has_maid_bedroom: null,
        is_agent_covered: null,
        is_commission_split: null,
        is_mortgage_approved: null,
        is_community_agnostic: null,
        mortgage_or_cash: [],
        keywords: [],
        location_names: [],
        ai_prompt: text, // Put original text as ai_prompt fallback
      },
      confidence: 0,
      warnings: [`Failed to parse: ${error instanceof Error ? error.message : 'Unknown error'}`],
    };
  }
}

/**
 * Build the Gemini prompt for file-based multi-criteria extraction
 */
export function buildFileParsePrompt(additionalContext?: string): string {
  const contextSection = additionalContext
    ? `\nADDITIONAL CONTEXT FROM USER:\n"${additionalContext}"\n`
    : '';

  return `You are a Dubai real estate search criteria parser. Analyze this document and extract ALL distinct buyer profiles/requirements into structured search criteria.

${contextSection}
IMPORTANT: A document may contain MULTIPLE different buyer requirements. Create a SEPARATE criteria object for each distinct search profile you identify. For example:
- If a buyer wants "2BR in Marina OR 3BR in JVC" → create TWO criteria objects
- If a document lists requirements for multiple clients → create one criteria per client
- If there's only one buyer profile → return an array with one criteria

OUTPUT: Valid JSON array of criteria objects:
[
  {
    "name": "Short descriptive name (e.g., '2BR Marina Apartment', 'Labor Camp in DIP')",
    "transaction_type": "sale" or "rent" (default "sale"),
    "property_types": ["apartment", "villa", "townhouse", "penthouse", "duplex", "office", "land", "retail", "shop", "showroom", "warehouse", "labor_camp", "staff_accommodation", "full_floor", "half_floor", "bulk_unit", "building", "hotel_apartment", "other"],
    "bedrooms": [array of integers, 0=studio],
    "bathrooms": [array of integers] or [],
    "min_price_aed": number or null,
    "max_price_aed": number or null,
    "min_area_sqft": number or null,
    "max_area_sqft": number or null,
    "furnishing": ["furnished", "unfurnished", "semi-furnished"] or [],
    "is_off_plan": true/false/null,
    "is_distressed_deal": true/false/null,
    "is_urgent": true/false/null,
    "is_direct": true/false/null,
    "has_maid_bedroom": true/false/null (if maid's room mentioned),
    "is_agent_covered": true/false/null (if agent fee covered by seller),
    "is_commission_split": true/false/null (if commission split mentioned),
    "is_mortgage_approved": true/false/null (if buyer is mortgage pre-approved),
    "is_community_agnostic": true/false/null (if buyer is flexible on location),
    "mortgage_or_cash": ["mortgage", "cash"] or [] (payment method preference),
    "keywords": ["keyword1", "keyword2"] or [] (specific searchable features),
    "location_names": ["Dubai Marina", "JBR", etc],
    "ai_prompt": "Requirements that can't be mapped to structured fields",
    "confidence": 0-100
  }
]

PARSING RULES:
1. Dubai prices are in AED. "2M" = 2,000,000, "500K" = 500,000
2. Area is typically in sqft. Convert sqm: 1 sqm = 10.764 sqft
3. "Studio" = bedrooms: [0]
4. "1-3BR" means bedrooms: [1, 2, 3]
5. Generate a descriptive "name" for each criteria (e.g., "2BR Marina Sale", "Labor Camp in DIP")
6. Put qualitative requirements in ai_prompt: sea view, high floor, upgraded, corner unit, pool view, specific amenities, person capacity, etc.
7. If you see "OR" conditions for different property types/locations, split into separate criteria
8. Only set boolean filters if EXPLICITLY mentioned
9. Property type mapping: "labor camp" or "labour camp" or "staff accommodation" or "worker accommodation" → property_types: ["labor_camp"]. "Warehouse" → ["warehouse"]. Use exact values from the allowed list.
10. "Maid's room", "maid bedroom", "helper's room" → has_maid_bedroom: true
11. "Agent covered", "seller pays agent" → is_agent_covered: true
12. "Commission split", "split commission" → is_commission_split: true
13. "Mortgage approved", "pre-approved", "finance ready" → is_mortgage_approved: true
14. "Flexible on location", "any area", "location flexible" → is_community_agnostic: true
15. "Cash buyer", "cash only", "cash deal" → mortgage_or_cash: ["cash"]
16. "Mortgage available", "can finance" → mortgage_or_cash: ["mortgage"]
17. Extract specific searchable feature keywords into keywords array (e.g., "Burj view", "upgraded", "corner unit")

IMPORTANT: Output ONLY the JSON array, no other text.`;
}

/**
 * Validate and normalize a single criteria from multi-criteria extraction
 */
function validateAndNormalizeNamed(raw: Record<string, unknown>): {
  parsed: NamedParsedCriteria;
  confidence: number;
} {
  const { result } = validateAndNormalize(raw);

  // Extract name, generate default if missing
  let name = 'New Search';
  if (typeof raw.name === 'string' && raw.name.trim()) {
    name = raw.name.trim();
  } else {
    // Generate name from criteria
    const parts: string[] = [];
    if (result.parsed.bedrooms.length === 1) {
      parts.push(result.parsed.bedrooms[0] === 0 ? 'Studio' : `${result.parsed.bedrooms[0]}BR`);
    } else if (result.parsed.bedrooms.length > 1) {
      parts.push(`${Math.min(...result.parsed.bedrooms)}-${Math.max(...result.parsed.bedrooms)}BR`);
    }
    if (result.parsed.location_names.length > 0) {
      parts.push(result.parsed.location_names[0].split(' ')[0]);
    }
    if (result.parsed.property_types.length === 1) {
      parts.push(result.parsed.property_types[0].charAt(0).toUpperCase() + result.parsed.property_types[0].slice(1));
    }
    parts.push(result.parsed.transaction_type === 'rent' ? 'Rent' : 'Sale');
    name = parts.join(' ') || 'New Search';
  }

  return {
    parsed: {
      ...result.parsed,
      name,
    },
    confidence: result.confidence,
  };
}

/**
 * Parse a file (PDF or image) into one or more structured criteria
 */
export async function parseFileToCriteria(
  fileData: string,
  mimeType: string,
  additionalContext?: string
): Promise<MultiParseResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable not configured');
  }

  const prompt = buildFileParsePrompt(additionalContext);
  const warnings: string[] = [];

  try {
    const raw = await callGeminiMultimodalJson<unknown[]>(apiKey, prompt, fileData, mimeType);

    // Ensure we have an array
    const rawArray = Array.isArray(raw) ? raw : [raw];

    // Validate each criteria
    const criteria = rawArray.map((item, index) => {
      try {
        return validateAndNormalizeNamed(item as Record<string, unknown>);
      } catch (err) {
        warnings.push(`Failed to parse criteria ${index + 1}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        return null;
      }
    }).filter((c): c is NonNullable<typeof c> => c !== null);

    if (criteria.length === 0) {
      warnings.push('No valid criteria could be extracted from the file');
    }

    return { criteria, warnings };
  } catch (error) {
    console.error('Failed to parse file:', error);
    return {
      criteria: [],
      warnings: [`Failed to parse file: ${error instanceof Error ? error.message : 'Unknown error'}`],
    };
  }
}
