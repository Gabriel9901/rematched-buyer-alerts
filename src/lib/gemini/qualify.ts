/**
 * Gemini Qualification Logic
 *
 * Uses Gemini to semantically score how well a listing matches buyer requirements.
 */

import { callGeminiJson } from './client';
import { TypesenseHit } from '../typesense/types';

export interface BuyerRequirements {
  name: string;
  propertyTypes?: string[];
  communities?: string[];
  developers?: string[];
  bedrooms?: number[];
  bathrooms?: number[];
  minPriceAed?: number;
  maxPriceAed?: number;
  minAreaSqft?: number;
  maxAreaSqft?: number;
  keywords?: string;
  additionalNotes?: string;
}

export interface QualificationResult {
  score: number; // 0-100
  isMatch: boolean; // score >= threshold
  explanation: string;
  highlights: string[]; // Key matching points
  concerns: string[]; // Potential issues
}

const QUALIFICATION_PROMPT = `You are a real estate matching assistant. Analyze how well this property listing matches the buyer's requirements.

BUYER REQUIREMENTS:
{requirements}

PROPERTY LISTING:
{listing}

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
 * Format buyer requirements for the prompt
 */
function formatRequirements(req: BuyerRequirements): string {
  const lines: string[] = [`Search: "${req.name}"`];

  if (req.propertyTypes?.length) {
    lines.push(`Property types: ${req.propertyTypes.join(', ')}`);
  }
  if (req.communities?.length) {
    lines.push(`Communities: ${req.communities.join(', ')}`);
  }
  if (req.developers?.length) {
    lines.push(`Developers: ${req.developers.join(', ')}`);
  }
  if (req.bedrooms?.length) {
    lines.push(`Bedrooms: ${req.bedrooms.join(', ')}`);
  }
  if (req.bathrooms?.length) {
    lines.push(`Bathrooms: ${req.bathrooms.join(', ')}`);
  }
  if (req.minPriceAed !== undefined || req.maxPriceAed !== undefined) {
    const min = req.minPriceAed ? `AED ${req.minPriceAed.toLocaleString()}` : 'any';
    const max = req.maxPriceAed ? `AED ${req.maxPriceAed.toLocaleString()}` : 'any';
    lines.push(`Price range: ${min} - ${max}`);
  }
  if (req.keywords) {
    lines.push(`Keywords: ${req.keywords}`);
  }
  if (req.additionalNotes) {
    lines.push(`\nIMPORTANT QUALIFICATION CRITERIA:\n${req.additionalNotes}`);
  }

  return lines.join('\n');
}

/**
 * Format listing data for the prompt
 */
function formatListing(hit: TypesenseHit): string {
  const doc = hit.document;
  const data = doc.data;

  const lines: string[] = [
    `Type: ${data.property_type}`,
    `Transaction: ${data.transaction_type}`,
    `Location: ${data.community || data.location_raw || 'Not specified'}`,
  ];

  if (data.developer) lines.push(`Developer: ${data.developer}`);
  if (data.bedrooms !== undefined) lines.push(`Bedrooms: ${data.bedrooms}`);
  if (data.bathrooms !== undefined) lines.push(`Bathrooms: ${data.bathrooms}`);
  if (data.price_aed) lines.push(`Price: AED ${data.price_aed.toLocaleString()}`);
  if (data.area_sqft) lines.push(`Area: ${data.area_sqft} sqft`);
  if (data.furnishing) lines.push(`Furnishing: ${data.furnishing}`);
  if (data.is_off_plan) lines.push(`Off-plan: Yes`);
  if (data.is_urgent) lines.push(`Urgent: Yes`);
  if (data.message_body_clean) {
    // Truncate long descriptions
    const desc = data.message_body_clean.length > 500
      ? data.message_body_clean.substring(0, 500) + '...'
      : data.message_body_clean;
    lines.push(`Description: ${desc}`);
  }
  if (data.other_details) {
    lines.push(`Details: ${data.other_details}`);
  }

  return lines.join('\n');
}

/**
 * Qualify a single listing against buyer requirements
 *
 * @param apiKey - Gemini API key
 * @param listing - The Typesense hit to evaluate
 * @param requirements - Buyer's requirements
 * @param threshold - Minimum score to be considered a match (default 60)
 */
export async function qualifyMatch(
  apiKey: string,
  listing: TypesenseHit,
  requirements: BuyerRequirements,
  threshold: number = 60
): Promise<QualificationResult> {
  const prompt = QUALIFICATION_PROMPT
    .replace('{requirements}', formatRequirements(requirements))
    .replace('{listing}', formatListing(listing));

  const result = await callGeminiJson<{
    score: number;
    explanation: string;
    highlights: string[];
    concerns: string[];
  }>(apiKey, prompt);

  return {
    score: Math.max(0, Math.min(100, result.score)),
    isMatch: result.score >= threshold,
    explanation: result.explanation,
    highlights: result.highlights || [],
    concerns: result.concerns || [],
  };
}

/**
 * Batch qualify multiple listings
 * Processes in parallel with concurrency limit
 *
 * @param apiKey - Gemini API key
 * @param listings - Array of Typesense hits
 * @param requirements - Buyer's requirements
 * @param options - Configuration options
 */
export async function qualifyMatches(
  apiKey: string,
  listings: TypesenseHit[],
  requirements: BuyerRequirements,
  options: {
    threshold?: number;
    concurrency?: number;
    onProgress?: (completed: number, total: number) => void;
  } = {}
): Promise<Array<{ listing: TypesenseHit; qualification: QualificationResult }>> {
  const { threshold = 60, concurrency = 5, onProgress } = options;

  const results: Array<{ listing: TypesenseHit; qualification: QualificationResult }> = [];
  let completed = 0;

  // Process in batches to respect rate limits
  for (let i = 0; i < listings.length; i += concurrency) {
    const batch = listings.slice(i, i + concurrency);

    const batchResults = await Promise.all(
      batch.map(async (listing) => {
        try {
          const qualification = await qualifyMatch(apiKey, listing, requirements, threshold);
          return { listing, qualification };
        } catch (error) {
          // On error, return a failed qualification
          console.error(`Failed to qualify listing ${listing.document.id}:`, error);
          return {
            listing,
            qualification: {
              score: 0,
              isMatch: false,
              explanation: 'Failed to qualify due to an error',
              highlights: [],
              concerns: ['Qualification failed'],
            },
          };
        }
      })
    );

    results.push(...batchResults);
    completed += batch.length;

    if (onProgress) {
      onProgress(completed, listings.length);
    }

    // Small delay between batches to avoid rate limiting
    if (i + concurrency < listings.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return results;
}
