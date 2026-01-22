/**
 * Gemini Qualification Logic
 *
 * Uses Gemini to semantically score how well a listing matches buyer requirements.
 */

import { callGeminiJson, callGeminiBatchJson } from './client';
import { TypesenseHit } from '../typesense/types';

// Default batch size for Gemini qualification (25 listings per API call)
const DEFAULT_BATCH_SIZE = 25;

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

/**
 * Batch qualification prompt template.
 * Includes buyer requirements once, then all listings with indexes.
 */
const BATCH_QUALIFICATION_PROMPT = `You are a real estate matching assistant. Analyze how well each of the following property listings matches the buyer's requirements.

BUYER REQUIREMENTS:
{requirements}

PROPERTY LISTINGS TO EVALUATE:
{listings}

For EACH listing above, evaluate the match and respond with ONLY a JSON array containing one object per listing in this exact format:
[
  {
    "listingIndex": <the listing number>,
    "score": <number 0-100>,
    "explanation": "<brief 1-2 sentence summary>",
    "highlights": ["<matching point 1>", "<matching point 2>"],
    "concerns": ["<potential issue 1>", "<potential issue 2>"]
  },
  ...
]

IMPORTANT: Include ALL listings in your response, in order. Do not skip any listing.

Scoring guide:
- 90-100: Perfect match on all criteria
- 70-89: Good match, minor deviations
- 50-69: Partial match, some criteria not met
- 30-49: Weak match, significant mismatches
- 0-29: Poor match, most criteria not met

Be strict but fair. Only include real highlights and concerns.`;

/**
 * Format multiple listings for batch qualification prompt
 */
function formatListingsForBatch(hits: TypesenseHit[]): string {
  return hits
    .map((hit, index) => {
      const listingNum = index + 1;
      const doc = hit.document;
      const data = doc.data;

      const lines: string[] = [
        `=== LISTING ${listingNum} ===`,
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
        const desc =
          data.message_body_clean.length > 500
            ? data.message_body_clean.substring(0, 500) + '...'
            : data.message_body_clean;
        lines.push(`Description: ${desc}`);
      }
      if (data.other_details) {
        lines.push(`Details: ${data.other_details}`);
      }

      return lines.join('\n');
    })
    .join('\n\n');
}

interface BatchQualificationResult {
  listingIndex: number;
  score: number;
  explanation: string;
  highlights: string[];
  concerns: string[];
}

/**
 * Batch qualify multiple listings in a single Gemini API call.
 * Reduces API calls from N to ceil(N/batchSize).
 *
 * @param apiKey - Gemini API key
 * @param listings - Array of Typesense hits
 * @param requirements - Buyer's requirements
 * @param options - Configuration options
 */
export async function qualifyMatchesBatched(
  apiKey: string,
  listings: TypesenseHit[],
  requirements: BuyerRequirements,
  options: {
    threshold?: number;
    batchSize?: number;
    onProgress?: (completed: number, total: number) => void;
    onBatchComplete?: (batchNumber: number, totalBatches: number, results: Array<{ listing: TypesenseHit; qualification: QualificationResult }>) => void;
  } = {}
): Promise<Array<{ listing: TypesenseHit; qualification: QualificationResult }>> {
  const { threshold = 60, batchSize = DEFAULT_BATCH_SIZE, onProgress, onBatchComplete } = options;

  const results: Array<{ listing: TypesenseHit; qualification: QualificationResult }> = [];
  const totalBatches = Math.ceil(listings.length / batchSize);

  // Process in batches
  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const batchStart = batchIndex * batchSize;
    const batchEnd = Math.min(batchStart + batchSize, listings.length);
    const batch = listings.slice(batchStart, batchEnd);

    try {
      // Build batch prompt
      const prompt = BATCH_QUALIFICATION_PROMPT
        .replace('{requirements}', formatRequirements(requirements))
        .replace('{listings}', formatListingsForBatch(batch));

      // Make single API call for entire batch
      const batchResults = await callGeminiBatchJson<BatchQualificationResult>(apiKey, prompt);

      // Create a map for quick lookup by listingIndex
      const resultMap = new Map<number, BatchQualificationResult>();
      for (const result of batchResults) {
        resultMap.set(result.listingIndex, result);
      }

      // Map results back to listings
      const batchMappedResults: Array<{ listing: TypesenseHit; qualification: QualificationResult }> = [];
      for (let i = 0; i < batch.length; i++) {
        const listingIndex = i + 1; // 1-based index
        const listing = batch[i];
        const qualResult = resultMap.get(listingIndex);

        if (qualResult) {
          const score = Math.max(0, Math.min(100, qualResult.score));
          batchMappedResults.push({
            listing,
            qualification: {
              score,
              isMatch: score >= threshold,
              explanation: qualResult.explanation || '',
              highlights: qualResult.highlights || [],
              concerns: qualResult.concerns || [],
            },
          });
        } else {
          // Missing result for this listing - mark as failed
          console.warn(`Missing qualification result for listing index ${listingIndex}`);
          batchMappedResults.push({
            listing,
            qualification: {
              score: 0,
              isMatch: false,
              explanation: 'Qualification result missing from batch response',
              highlights: [],
              concerns: ['Missing from batch response'],
            },
          });
        }
      }

      results.push(...batchMappedResults);

      // Notify batch completion
      if (onBatchComplete) {
        onBatchComplete(batchIndex + 1, totalBatches, batchMappedResults);
      }

      // Notify progress
      if (onProgress) {
        onProgress(results.length, listings.length);
      }
    } catch (error) {
      // Batch failed - mark all listings in batch as failed
      console.error(`Batch ${batchIndex + 1} failed:`, error);

      const batchFailedResults: Array<{ listing: TypesenseHit; qualification: QualificationResult }> = batch.map(
        (listing) => ({
          listing,
          qualification: {
            score: 0,
            isMatch: false,
            explanation: 'Batch qualification failed due to an error',
            highlights: [],
            concerns: ['Batch qualification failed'],
          },
        })
      );

      results.push(...batchFailedResults);

      if (onBatchComplete) {
        onBatchComplete(batchIndex + 1, totalBatches, batchFailedResults);
      }

      if (onProgress) {
        onProgress(results.length, listings.length);
      }
    }

    // Small delay between batches to avoid rate limiting
    if (batchIndex < totalBatches - 1) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  return results;
}
