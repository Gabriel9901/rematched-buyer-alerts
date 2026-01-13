/**
 * Prompt Template Utilities
 *
 * Handles granular placeholder replacement for AI qualification prompts.
 * Provides a clear mapping of what data is being injected into prompts.
 */

import { BuyerRequirements } from './qualify';
import { TypesenseHit } from '../typesense/types';

/**
 * All available placeholders for buyer requirements
 */
export const BUYER_PLACEHOLDERS = {
  search_name: '{search_name}',
  property_types: '{property_types}',
  communities: '{communities}',
  developers: '{developers}',
  bedrooms: '{bedrooms}',
  bathrooms: '{bathrooms}',
  price_range: '{price_range}',
  area_range: '{area_range}',
  keywords: '{keywords}',
  additional_notes: '{additional_notes}',
} as const;

/**
 * All available placeholders for listing data
 */
export const LISTING_PLACEHOLDERS = {
  listing_type: '{listing_type}',
  listing_transaction: '{listing_transaction}',
  listing_location: '{listing_location}',
  listing_developer: '{listing_developer}',
  listing_bedrooms: '{listing_bedrooms}',
  listing_bathrooms: '{listing_bathrooms}',
  listing_price: '{listing_price}',
  listing_area: '{listing_area}',
  listing_furnishing: '{listing_furnishing}',
  listing_is_off_plan: '{listing_is_off_plan}',
  listing_is_urgent: '{listing_is_urgent}',
  listing_description: '{listing_description}',
} as const;

/**
 * Placeholder documentation for UI display
 */
export const PLACEHOLDER_DOCS = {
  buyer_requirements: [
    { name: '{search_name}', description: 'Name of the search criteria' },
    { name: '{property_types}', description: 'Property types (apartment, villa, etc.)' },
    { name: '{communities}', description: 'Target communities/locations' },
    { name: '{developers}', description: 'Preferred developers' },
    { name: '{bedrooms}', description: 'Number of bedrooms' },
    { name: '{bathrooms}', description: 'Number of bathrooms' },
    { name: '{price_range}', description: 'Price range in AED' },
    { name: '{area_range}', description: 'Area range in sqft' },
    { name: '{keywords}', description: 'Search keywords' },
    { name: '{additional_notes}', description: 'Custom qualification criteria (ai_prompt field)' },
  ],
  listing_data: [
    { name: '{listing_type}', description: 'Property type' },
    { name: '{listing_transaction}', description: 'Transaction type (sale/rent)' },
    { name: '{listing_location}', description: 'Property location' },
    { name: '{listing_developer}', description: 'Developer name' },
    { name: '{listing_bedrooms}', description: 'Number of bedrooms' },
    { name: '{listing_bathrooms}', description: 'Number of bathrooms' },
    { name: '{listing_price}', description: 'Property price' },
    { name: '{listing_area}', description: 'Area in sqft' },
    { name: '{listing_furnishing}', description: 'Furnishing status' },
    { name: '{listing_is_off_plan}', description: 'Is off-plan property' },
    { name: '{listing_is_urgent}', description: 'Is urgent listing' },
    { name: '{listing_description}', description: 'Full listing description (truncated to 500 chars)' },
  ],
};

/**
 * Format a value for display, handling arrays, nulls, and numbers
 */
function formatValue(value: unknown, suffix?: string): string {
  if (value === null || value === undefined) {
    return 'Not specified';
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return 'Not specified';
    return value.join(', ');
  }
  if (typeof value === 'number') {
    const formatted = value.toLocaleString();
    return suffix ? `${formatted} ${suffix}` : formatted;
  }
  return String(value);
}

/**
 * Format price with AED prefix
 */
function formatPrice(value: number | undefined | null): string {
  if (value === null || value === undefined) return 'Not specified';
  return `AED ${value.toLocaleString()}`;
}

/**
 * Extract buyer requirement values from BuyerRequirements object
 * Returns a map of placeholder -> value
 */
export function extractBuyerValues(req: BuyerRequirements): Record<string, string> {
  // Format price range
  let priceRange = 'Not specified';
  if (req.minPriceAed !== undefined || req.maxPriceAed !== undefined) {
    const min = req.minPriceAed ? formatPrice(req.minPriceAed) : 'any';
    const max = req.maxPriceAed ? formatPrice(req.maxPriceAed) : 'any';
    priceRange = `${min} - ${max}`;
  }

  // Format area range (if we have it in extended requirements)
  const extReq = req as BuyerRequirements & { minAreaSqft?: number; maxAreaSqft?: number };
  let areaRange = 'Not specified';
  if (extReq.minAreaSqft !== undefined || extReq.maxAreaSqft !== undefined) {
    const min = extReq.minAreaSqft ? `${extReq.minAreaSqft.toLocaleString()} sqft` : 'any';
    const max = extReq.maxAreaSqft ? `${extReq.maxAreaSqft.toLocaleString()} sqft` : 'any';
    areaRange = `${min} - ${max}`;
  }

  // Format additional notes with emphasis
  let additionalNotes = '';
  if (req.additionalNotes) {
    additionalNotes = `\nIMPORTANT QUALIFICATION CRITERIA:\n${req.additionalNotes}`;
  }

  return {
    [BUYER_PLACEHOLDERS.search_name]: req.name || 'Unnamed Search',
    [BUYER_PLACEHOLDERS.property_types]: formatValue(req.propertyTypes),
    [BUYER_PLACEHOLDERS.communities]: formatValue(req.communities),
    [BUYER_PLACEHOLDERS.developers]: formatValue(req.developers),
    [BUYER_PLACEHOLDERS.bedrooms]: formatValue(req.bedrooms),
    [BUYER_PLACEHOLDERS.bathrooms]: formatValue(req.bathrooms),
    [BUYER_PLACEHOLDERS.price_range]: priceRange,
    [BUYER_PLACEHOLDERS.area_range]: areaRange,
    [BUYER_PLACEHOLDERS.keywords]: req.keywords || 'Not specified',
    [BUYER_PLACEHOLDERS.additional_notes]: additionalNotes,
  };
}

/**
 * Extract listing values from a Typesense hit
 * Returns a map of placeholder -> value
 */
export function extractListingValues(hit: TypesenseHit): Record<string, string> {
  const doc = hit.document;
  const data = doc.data;

  // Truncate long descriptions
  let description = data.message_body_clean || 'No description';
  if (description.length > 500) {
    description = description.substring(0, 500) + '...';
  }

  return {
    [LISTING_PLACEHOLDERS.listing_type]: data.property_type || 'Not specified',
    [LISTING_PLACEHOLDERS.listing_transaction]: data.transaction_type || 'Not specified',
    [LISTING_PLACEHOLDERS.listing_location]: data.community || data.location_raw || 'Not specified',
    [LISTING_PLACEHOLDERS.listing_developer]: data.developer || 'Not specified',
    [LISTING_PLACEHOLDERS.listing_bedrooms]: data.bedrooms !== undefined ? String(data.bedrooms) : 'Not specified',
    [LISTING_PLACEHOLDERS.listing_bathrooms]: data.bathrooms !== undefined ? String(data.bathrooms) : 'Not specified',
    [LISTING_PLACEHOLDERS.listing_price]: data.price_aed ? formatPrice(data.price_aed) : 'Not specified',
    [LISTING_PLACEHOLDERS.listing_area]: data.area_sqft ? `${data.area_sqft.toLocaleString()} sqft` : 'Not specified',
    [LISTING_PLACEHOLDERS.listing_furnishing]: data.furnishing || 'Not specified',
    [LISTING_PLACEHOLDERS.listing_is_off_plan]: data.is_off_plan ? 'Yes' : 'No',
    [LISTING_PLACEHOLDERS.listing_is_urgent]: data.is_urgent ? 'Yes' : 'No',
    [LISTING_PLACEHOLDERS.listing_description]: description,
  };
}

/**
 * Fill all placeholders in a template string
 */
export function fillPlaceholders(
  template: string,
  buyerValues: Record<string, string>,
  listingValues: Record<string, string>
): string {
  let result = template;

  // Replace buyer placeholders
  for (const [placeholder, value] of Object.entries(buyerValues)) {
    result = result.replace(new RegExp(escapeRegex(placeholder), 'g'), value);
  }

  // Replace listing placeholders
  for (const [placeholder, value] of Object.entries(listingValues)) {
    result = result.replace(new RegExp(escapeRegex(placeholder), 'g'), value);
  }

  return result;
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a complete prompt from template and data
 */
export function buildPromptFromTemplate(
  template: string,
  requirements: BuyerRequirements,
  listing: TypesenseHit
): string {
  const buyerValues = extractBuyerValues(requirements);
  const listingValues = extractListingValues(listing);
  return fillPlaceholders(template, buyerValues, listingValues);
}

/**
 * The default system prompt template with all granular placeholders
 */
export const DEFAULT_SYSTEM_PROMPT = `You are a real estate matching assistant. Analyze how well this property listing matches the buyer's requirements.

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

Be strict but fair. Only include real highlights and concerns.`;

/**
 * Validate that a template contains all required placeholders
 * Returns an object with missing placeholders if any
 */
export function validateTemplate(template: string): {
  isValid: boolean;
  missingBuyer: string[];
  missingListing: string[];
} {
  const missingBuyer: string[] = [];
  const missingListing: string[] = [];

  // Check for at least some buyer placeholders (not all are required)
  const hasAnyBuyerPlaceholder = Object.values(BUYER_PLACEHOLDERS).some((p) =>
    template.includes(p)
  );

  // Check for at least some listing placeholders
  const hasAnyListingPlaceholder = Object.values(LISTING_PLACEHOLDERS).some((p) =>
    template.includes(p)
  );

  // A valid template should have at least one placeholder from each category
  // to ensure the AI can compare requirements to listings
  if (!hasAnyBuyerPlaceholder) {
    missingBuyer.push('At least one buyer requirement placeholder');
  }
  if (!hasAnyListingPlaceholder) {
    missingListing.push('At least one listing data placeholder');
  }

  return {
    isValid: hasAnyBuyerPlaceholder && hasAnyListingPlaceholder,
    missingBuyer,
    missingListing,
  };
}

/**
 * Get preview of how placeholders will be filled
 * Useful for showing users what values will be substituted
 */
export function getPlaceholderPreview(
  requirements: BuyerRequirements,
  listing?: TypesenseHit
): { placeholder: string; value: string; category: 'buyer' | 'listing' }[] {
  const preview: { placeholder: string; value: string; category: 'buyer' | 'listing' }[] = [];

  // Add buyer values
  const buyerValues = extractBuyerValues(requirements);
  for (const [placeholder, value] of Object.entries(buyerValues)) {
    preview.push({
      placeholder,
      value: value.substring(0, 100) + (value.length > 100 ? '...' : ''),
      category: 'buyer',
    });
  }

  // Add listing values if provided
  if (listing) {
    const listingValues = extractListingValues(listing);
    for (const [placeholder, value] of Object.entries(listingValues)) {
      preview.push({
        placeholder,
        value: value.substring(0, 100) + (value.length > 100 ? '...' : ''),
        category: 'listing',
      });
    }
  }

  return preview;
}
