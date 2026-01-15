/**
 * Streaming Search Endpoint (SSE) with Debug Mode
 *
 * Runs a search with real-time progress updates via Server-Sent Events.
 * Debug mode includes raw payloads for Typesense results, Gemini prompts, and responses.
 *
 * Supports temporal deduplication: uses last_run_at to only search for new listings.
 * Pass `fullRescan: true` in the request body to ignore last_run_at and do a full search.
 */

import { NextRequest } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/client';
import { buildSimpleSearchBody, Criteria } from '@/lib/typesense';
import { typesenseMultiSearch } from '@/lib/typesense/client';
import { BuyerRequirements } from '@/lib/gemini/qualify';
import { BuyerCriteria, SystemPromptSetting, Buyer } from '@/lib/supabase/types';
import { TypesenseHit } from '@/lib/typesense/types';
import { DEFAULT_SYSTEM_PROMPT } from '@/lib/gemini/promptTemplate';

// Gemini API URL
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent';

// Default batch size for Gemini qualification
const BATCH_SIZE = 50;

interface SearchResults {
  totalSearches: number;
  totalMatches: number;
  newMatches: number;
  totalListingsFound: number;
  totalListingsDeduped: number;
  fullRescan: boolean;
  errors: string[];
  criteriaResults: Array<{
    criteriaId: string;
    criteriaName: string;
    buyerName: string;
    found: number;
    deduped: number;
    qualified: number;
    saved: number;
    usedTemporalFilter: boolean;
  }>;
  duration: number;
}

// Default days to look back if no last_run_at is set
const DEFAULT_LOOKBACK_DAYS = 7;

// Convert DB criteria to Typesense criteria with temporal filtering
function toTypesenseCriteria(
  dbCriteria: BuyerCriteria,
  useTemporalFilter: boolean = true,
  customDateFrom?: string,
  customDateTo?: string
): Criteria {
  // Determine the date filter based on custom dates, last_run_at, or explicit date_from
  let dateFrom: number | undefined = undefined;
  let dateTo: number | undefined = undefined;

  // Custom date range takes priority (from time range dialog)
  if (customDateFrom) {
    dateFrom = Math.floor(new Date(customDateFrom).getTime() / 1000);
  } else if (useTemporalFilter && dbCriteria.last_run_at) {
    // Use last_run_at for temporal filtering - only get listings since last run
    dateFrom = Math.floor(new Date(dbCriteria.last_run_at).getTime() / 1000);
  } else if (dbCriteria.date_from) {
    // Use explicit date_from from criteria if set
    dateFrom = Math.floor(new Date(dbCriteria.date_from).getTime() / 1000);
  }
  // If neither is set, sinceDaysAgo will be used as fallback

  // Custom dateTo if provided, otherwise use criteria's date_to
  if (customDateTo) {
    dateTo = Math.floor(new Date(customDateTo).getTime() / 1000);
  } else if (dbCriteria.date_to) {
    dateTo = Math.floor(new Date(dbCriteria.date_to).getTime() / 1000);
  }

  return {
    userId: process.env.APP_USER_ID || 'user_default',
    q: dbCriteria.keywords || '*',
    kind: dbCriteria.kind as 'listing' | 'client_request',
    transactionType: dbCriteria.transaction_type as 'sale' | 'rent',
    propertyTypes: dbCriteria.property_types || undefined,
    communities: dbCriteria.communities || undefined,
    developers: dbCriteria.developers || undefined,
    bedrooms: dbCriteria.bedrooms || undefined,
    bathrooms: dbCriteria.bathrooms || undefined,
    minPriceAed: dbCriteria.min_price_aed || undefined,
    maxPriceAed: dbCriteria.max_price_aed || undefined,
    minAreaSqft: dbCriteria.min_area_sqft || undefined,
    maxAreaSqft: dbCriteria.max_area_sqft || undefined,
    pslCodes: dbCriteria.psl_codes || undefined,
    isOffPlan: dbCriteria.is_off_plan ?? undefined,
    isDistressedDeal: dbCriteria.is_distressed_deal ?? undefined,
    isUrgent: dbCriteria.is_urgent ?? undefined,
    isDirect: dbCriteria.is_direct ?? undefined,
    hasMaidBedroom: dbCriteria.has_maid_bedroom ?? undefined,
    isAgentCovered: dbCriteria.is_agent_covered ?? undefined,
    isCommissionSplit: dbCriteria.is_commission_split ?? undefined,
    isMortgageApproved: dbCriteria.is_mortgage_approved ?? undefined,
    isCommunityAgnostic: dbCriteria.is_community_agnostic ?? undefined,
    furnishing: dbCriteria.furnishing || undefined,
    mortgageOrCash: dbCriteria.mortgage_or_cash || undefined,
    // Temporal filtering: use dateFrom from custom date, last_run_at, or criteria setting
    dateFrom: dateFrom,
    dateTo: dateTo,
    // Fallback: if no dateFrom is set AND we're using temporal filtering, use sinceDaysAgo
    // When useTemporalFilter is false (fullRescan/all time), don't apply any date filter
    sinceDaysAgo: (dateFrom || !useTemporalFilter) ? undefined : DEFAULT_LOOKBACK_DAYS,
    perPage: 100, // Increased from 25 to get more results
  };
}

/**
 * Deduplicate listings by ID within a single search run.
 * Returns only listings that haven't been seen before.
 */
function deduplicateListings(
  hits: TypesenseHit[],
  seenListingIds: Set<string>
): TypesenseHit[] {
  const uniqueHits: TypesenseHit[] = [];

  for (const hit of hits) {
    const listingId = hit.document.id;
    if (!seenListingIds.has(listingId)) {
      seenListingIds.add(listingId);
      uniqueHits.push(hit);
    }
  }

  return uniqueHits;
}

// Convert DB criteria to buyer requirements for Gemini
function toBuyerRequirements(dbCriteria: BuyerCriteria): BuyerRequirements {
  return {
    name: dbCriteria.name,
    propertyTypes: dbCriteria.property_types || undefined,
    communities: dbCriteria.communities || undefined,
    developers: dbCriteria.developers || undefined,
    bedrooms: dbCriteria.bedrooms || undefined,
    bathrooms: dbCriteria.bathrooms || undefined,
    minPriceAed: dbCriteria.min_price_aed || undefined,
    maxPriceAed: dbCriteria.max_price_aed || undefined,
    minAreaSqft: dbCriteria.min_area_sqft || undefined,
    maxAreaSqft: dbCriteria.max_area_sqft || undefined,
    keywords: dbCriteria.keywords || undefined,
    additionalNotes: dbCriteria.ai_prompt || undefined,
  };
}

/**
 * Format buyer requirements for the batch prompt
 */
function formatRequirementsForBatch(req: BuyerRequirements): string {
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

/**
 * Build batch qualification prompt
 */
function buildBatchPrompt(requirements: BuyerRequirements, listings: TypesenseHit[]): string {
  return `You are a real estate matching assistant. Analyze how well each of the following property listings matches the buyer's requirements.

BUYER REQUIREMENTS:
${formatRequirementsForBatch(requirements)}

PROPERTY LISTINGS TO EVALUATE:
${formatListingsForBatch(listings)}

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
}

interface BatchQualificationResult {
  listingIndex: number;
  score: number;
  explanation: string;
  highlights: string[];
  concerns: string[];
}

/**
 * Extract complete JSON objects from a potentially truncated array response.
 */
function extractCompleteJsonObjects(text: string): BatchQualificationResult[] {
  const pattern = /\{\s*"listingIndex"\s*:\s*\d+\s*,\s*"score"\s*:\s*[\d.]+\s*,\s*"explanation"\s*:\s*"[^"]*(?:\\.[^"]*)*"\s*,\s*"highlights"\s*:\s*\[[^\]]*\]\s*,\s*"concerns"\s*:\s*\[[^\]]*\]\s*\}/g;

  const matches = text.match(pattern);
  if (!matches) {
    return [];
  }

  const results: BatchQualificationResult[] = [];
  for (const match of matches) {
    try {
      results.push(JSON.parse(match));
    } catch {
      // Skip malformed objects
    }
  }
  return results;
}

// Call Gemini API with batch prompt and return both request and response for debug
async function callGeminiBatchWithDebug(apiKey: string, prompt: string): Promise<{
  request: object;
  response: object;
  parsed: BatchQualificationResult[];
}> {
  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
  };

  const response = await fetch(GEMINI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(requestBody),
  });

  const responseData = await response.json();

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const text = responseData.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('No text in Gemini response');
  }

  // Extract JSON from response (handle markdown code blocks)
  let jsonStr = text;
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  // Try to parse as complete JSON array first
  let parsed: BatchQualificationResult[];
  try {
    const fullParsed = JSON.parse(jsonStr);
    if (Array.isArray(fullParsed)) {
      parsed = fullParsed;
    } else if (fullParsed.results && Array.isArray(fullParsed.results)) {
      parsed = fullParsed.results;
    } else {
      throw new Error('Response is not an array');
    }
  } catch {
    // If full parse fails, extract complete objects
    console.warn('Full JSON parse failed, extracting complete objects');
    parsed = extractCompleteJsonObjects(text);
  }

  // Normalize scores
  parsed = parsed.map((item) => ({
    ...item,
    score: Math.max(0, Math.min(100, item.score)),
    highlights: item.highlights || [],
    concerns: item.concerns || [],
  }));

  return {
    request: requestBody,
    response: responseData,
    parsed,
  };
}

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();
  // Get the abort signal from the request - triggers when client disconnects
  const signal = request.signal;

  const stream = new ReadableStream({
    async start(controller) {
      // Helper to check if client disconnected
      const isAborted = () => signal.aborted;

      const sendEvent = (event: object) => {
        // Don't send events if client disconnected
        if (isAborted()) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Stream may be closed
        }
      };

      // Send keepalive comment every 15 seconds to prevent proxy timeouts
      const keepaliveInterval = setInterval(() => {
        if (isAborted()) {
          clearInterval(keepaliveInterval);
          return;
        }
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          clearInterval(keepaliveInterval);
        }
      }, 15000);

      const startTime = Date.now();

      try {
        const body = await request.json();
        const {
          buyerId,
          criteriaId,
          debugMode = false,
          qualificationPrompt: customPromptFromUI,
          fullRescan = false, // If true, ignore last_run_at and do full search
          customDateFrom, // Custom date range start (ISO string)
          customDateTo,   // Custom date range end (ISO string)
        } = body;

        if (!buyerId && !criteriaId) {
          sendEvent({ step: 'error', message: 'Either buyerId or criteriaId is required' });
          controller.close();
          return;
        }

        const supabase = getServerSupabase();
        const typesenseKey = process.env.TYPESENSE_SCOPED_KEY;
        const geminiKey = process.env.GEMINI_API_KEY;

        if (!typesenseKey || !geminiKey) {
          sendEvent({ step: 'error', message: 'Missing API keys' });
          controller.close();
          return;
        }

        // Fetch the default system prompt from app_settings
        let defaultSystemPrompt = DEFAULT_SYSTEM_PROMPT;
        const { data: defaultPromptSetting } = await supabase
          .from('app_settings')
          .select('value')
          .eq('key', 'default_system_prompt')
          .single();

        if (defaultPromptSetting?.value) {
          const setting = defaultPromptSetting.value as SystemPromptSetting;
          if (setting.template) {
            defaultSystemPrompt = setting.template;
          }
        }

        // Fetch criteria with buyer info (includes buyer.system_prompt)
        let query = supabase
          .from('buyer_criteria')
          .select(`*, buyer:buyers(*)`)
          .eq('is_active', true);

        if (criteriaId) {
          query = query.eq('id', criteriaId);
        } else if (buyerId) {
          query = query.eq('buyer_id', buyerId);
        }

        const { data: criteriaList, error: criteriaError } = await query;

        if (criteriaError) {
          sendEvent({ step: 'error', message: `Failed to fetch criteria: ${criteriaError.message}` });
          controller.close();
          return;
        }

        if (!criteriaList || criteriaList.length === 0) {
          sendEvent({
            step: 'complete',
            results: {
              totalSearches: 0,
              totalMatches: 0,
              newMatches: 0,
              totalListingsFound: 0,
              totalListingsDeduped: 0,
              fullRescan,
              errors: [],
              criteriaResults: [],
              duration: Date.now() - startTime,
            },
          });
          controller.close();
          return;
        }

        const results: SearchResults = {
          totalSearches: 0,
          totalMatches: 0,
          newMatches: 0,
          totalListingsFound: 0,
          totalListingsDeduped: 0,
          fullRescan,
          errors: [],
          criteriaResults: [],
          duration: 0,
        };

        // Track seen listing IDs across all criteria for in-memory deduplication
        const seenListingIds = new Set<string>();

        // Track criteria IDs that were successfully processed (for updating last_run_at)
        const processedCriteriaIds: string[] = [];

        // Process each criteria
        for (const criteria of criteriaList) {
          // Check if client disconnected before processing next criteria
          if (isAborted()) {
            console.log('Client disconnected, stopping search');
            break;
          }

          const buyerName = (criteria.buyer as { name: string })?.name || 'Unknown';
          // Use temporal filter unless fullRescan is requested
          const useTemporalFilter = !fullRescan;
          const usedTemporalFilter = useTemporalFilter && !!criteria.last_run_at;

          try {
            results.totalSearches++;
            const criteriaName = criteria.name;

            // Step 1: Build Typesense query (uses last_run_at for temporal filtering unless fullRescan)
            sendEvent({
              step: 'searching',
              criteriaName,
              usedTemporalFilter,
              lastRunAt: criteria.last_run_at,
            });

            const searchCriteria = toTypesenseCriteria(criteria, useTemporalFilter, customDateFrom, customDateTo);
            const searchBody = buildSimpleSearchBody(searchCriteria);

            // Debug: Send the Typesense query
            if (debugMode) {
              sendEvent({
                step: 'debug_typesense_query',
                criteriaName,
                query: searchBody,
              });
            }

            const searchResult = await typesenseMultiSearch(typesenseKey, searchBody);
            const rawHits = searchResult.results[0]?.hits || [];
            const rawFound = rawHits.length;
            results.totalListingsFound += rawFound;

            // Debug: Send the raw Typesense response (before processing)
            if (debugMode) {
              // Cast to Record to access all fields from actual Typesense API response
              const typesenseResponse = searchResult.results[0] as unknown as Record<string, unknown>;
              sendEvent({
                step: 'debug_typesense_response',
                criteriaName,
                rawResponse: {
                  found: (typesenseResponse?.found as number) || 0,
                  out_of: (typesenseResponse?.out_of as number) || 0,
                  page: (typesenseResponse?.page as number) || 1,
                  request_params: typesenseResponse?.request_params,
                  search_time_ms: (typesenseResponse?.search_time_ms as number) || 0,
                  hits_count: rawHits.length,
                },
              });
            }

            // Step 2: Found results - include raw listings in debug mode
            sendEvent({
              step: 'found',
              criteriaName,
              count: rawHits.length,
              total: searchResult.results[0]?.found || 0,
              // Debug: Include raw listings for review
              ...(debugMode && {
                listings: rawHits.map((hit: TypesenseHit) => ({
                  id: hit.document.id,
                  data: hit.document.data,
                  highlights: hit.highlights,
                })),
              }),
            });

            if (rawHits.length === 0) {
              results.criteriaResults.push({
                criteriaId: criteria.id,
                criteriaName,
                buyerName,
                found: 0,
                deduped: 0,
                qualified: 0,
                saved: 0,
                usedTemporalFilter,
              });
              // Still mark as processed for updating last_run_at
              processedCriteriaIds.push(criteria.id);
              continue;
            }

            // Step 2.5: Deduplicate listings that were already seen in this run
            const hits = deduplicateListings(rawHits, seenListingIds);
            const dedupedCount = rawFound - hits.length;
            results.totalListingsDeduped += dedupedCount;

            if (dedupedCount > 0) {
              sendEvent({
                step: 'deduped',
                criteriaName,
                originalCount: rawFound,
                dedupedCount,
                remainingCount: hits.length,
              });
            }

            if (hits.length === 0) {
              results.criteriaResults.push({
                criteriaId: criteria.id,
                criteriaName,
                buyerName,
                found: rawFound,
                deduped: dedupedCount,
                qualified: 0,
                saved: 0,
                usedTemporalFilter,
              });
              processedCriteriaIds.push(criteria.id);
              continue;
            }

            // Step 3: Qualify with Gemini (batched - 50 listings per API call)
            const buyerRequirements = toBuyerRequirements(criteria);

            // Determine which prompt template to use:
            // 1. UI-provided custom prompt (highest priority)
            // 2. Buyer's custom system_prompt
            // 3. Default system prompt from app_settings
            // Note: For batched processing, we use the requirements directly in the prompt
            const buyer = criteria.buyer as Buyer | null;
            const promptSource = customPromptFromUI
              ? 'UI (custom)'
              : buyer?.system_prompt
                ? 'Buyer-specific'
                : 'Default';

            // If there's a custom AI prompt, include it in the requirements
            if (customPromptFromUI) {
              buyerRequirements.additionalNotes = customPromptFromUI;
            } else if (buyer?.system_prompt) {
              // Extract any custom instructions from buyer's system prompt
              buyerRequirements.additionalNotes = buyer.system_prompt;
            }

            // Debug: Log which prompt source is being used
            if (debugMode) {
              sendEvent({
                step: 'debug_prompt_source',
                criteriaName,
                promptSource,
                batchSize: BATCH_SIZE,
              });
            }

            const qualifiedMatches: Array<{
              listing: TypesenseHit;
              qualification: { score: number; isMatch: boolean; explanation: string; highlights: string[]; concerns: string[] };
            }> = [];

            const totalBatches = Math.ceil(hits.length / BATCH_SIZE);

            for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
              // Check if client disconnected before processing batch
              if (isAborted()) {
                console.log('Client disconnected, stopping qualification');
                break;
              }

              const batchStart = batchIndex * BATCH_SIZE;
              const batchEnd = Math.min(batchStart + BATCH_SIZE, hits.length);
              const batch = hits.slice(batchStart, batchEnd);

              sendEvent({
                step: 'qualifying_batch',
                criteriaName,
                batchNumber: batchIndex + 1,
                totalBatches,
                batchStart: batchStart + 1,
                batchEnd,
                total: hits.length,
                listingsInBatch: batch.length,
              });

              // Build batch prompt
              const batchPrompt = buildBatchPrompt(buyerRequirements, batch);

              // Debug: Send the batch Gemini request before making the call
              if (debugMode) {
                sendEvent({
                  step: 'debug_gemini_batch_request',
                  criteriaName,
                  batchNumber: batchIndex + 1,
                  listingCount: batch.length,
                  prompt: batchPrompt,
                  listingSummaries: batch.map((listing, idx) => ({
                    index: idx + 1,
                    id: listing.document.id,
                    type: listing.document.data.property_type,
                    location: listing.document.data.location_raw || listing.document.data.community,
                    price: listing.document.data.price_aed,
                    bedrooms: listing.document.data.bedrooms,
                  })),
                });
              }

              try {
                const geminiResult = await callGeminiBatchWithDebug(geminiKey, batchPrompt);

                // Debug: Send raw Gemini batch response
                if (debugMode) {
                  sendEvent({
                    step: 'debug_gemini_batch_response',
                    criteriaName,
                    batchNumber: batchIndex + 1,
                    rawResponse: geminiResult.response,
                    parsedResultCount: geminiResult.parsed.length,
                    parsedResults: geminiResult.parsed,
                  });
                }

                // Create a map for quick lookup by listingIndex
                const resultMap = new Map<number, BatchQualificationResult>();
                for (const result of geminiResult.parsed) {
                  resultMap.set(result.listingIndex, result);
                }

                // Map results back to listings
                for (let i = 0; i < batch.length; i++) {
                  const listingIndex = i + 1; // 1-based index within batch
                  const listing = batch[i];
                  const qualResult = resultMap.get(listingIndex);
                  const globalIndex = batchStart + i;

                  if (qualResult) {
                    const score = Math.max(0, Math.min(100, qualResult.score));
                    const isMatch = score >= 60;

                    qualifiedMatches.push({
                      listing,
                      qualification: {
                        score,
                        isMatch,
                        explanation: qualResult.explanation || '',
                        highlights: qualResult.highlights || [],
                        concerns: qualResult.concerns || [],
                      },
                    });

                    // Send individual qualification result
                    sendEvent({
                      step: 'qualified',
                      criteriaName,
                      current: globalIndex + 1,
                      total: hits.length,
                      score,
                      isMatch,
                      ...(debugMode && {
                        explanation: qualResult.explanation,
                        highlights: qualResult.highlights,
                        concerns: qualResult.concerns,
                      }),
                    });
                  } else {
                    // Missing result for this listing
                    console.warn(`Missing qualification result for listing index ${listingIndex} in batch ${batchIndex + 1}`);
                    qualifiedMatches.push({
                      listing,
                      qualification: {
                        score: 0,
                        isMatch: false,
                        explanation: 'Qualification result missing from batch response',
                        highlights: [],
                        concerns: ['Missing from batch response'],
                      },
                    });

                    sendEvent({
                      step: 'qualified',
                      criteriaName,
                      current: globalIndex + 1,
                      total: hits.length,
                      score: 0,
                      isMatch: false,
                      ...(debugMode && {
                        explanation: 'Qualification result missing from batch response',
                        highlights: [],
                        concerns: ['Missing from batch response'],
                      }),
                    });
                  }
                }
              } catch (error) {
                console.error(`Batch ${batchIndex + 1} failed:`, error);

                if (debugMode) {
                  sendEvent({
                    step: 'debug_gemini_batch_error',
                    criteriaName,
                    batchNumber: batchIndex + 1,
                    error: error instanceof Error ? error.message : 'Unknown error',
                  });
                }

                // Mark all listings in batch as failed
                for (let i = 0; i < batch.length; i++) {
                  const listing = batch[i];
                  const globalIndex = batchStart + i;

                  qualifiedMatches.push({
                    listing,
                    qualification: {
                      score: 0,
                      isMatch: false,
                      explanation: 'Batch qualification failed due to an error',
                      highlights: [],
                      concerns: ['Batch qualification failed'],
                    },
                  });

                  sendEvent({
                    step: 'qualified',
                    criteriaName,
                    current: globalIndex + 1,
                    total: hits.length,
                    score: 0,
                    isMatch: false,
                    ...(debugMode && {
                      explanation: 'Batch qualification failed due to an error',
                      highlights: [],
                      concerns: ['Batch qualification failed'],
                    }),
                  });
                }
              }

              // Delay between batches (not after last batch)
              if (batchIndex < totalBatches - 1) {
                await new Promise((resolve) => setTimeout(resolve, 200));
              }
            }

            // Filter to good matches
            const goodMatches = qualifiedMatches.filter((m) => m.qualification.isMatch);
            results.totalMatches += goodMatches.length;

            // Debug: Summary of qualification results
            if (debugMode) {
              sendEvent({
                step: 'debug_qualification_summary',
                criteriaName,
                totalProcessed: qualifiedMatches.length,
                matched: goodMatches.length,
                rejected: qualifiedMatches.length - goodMatches.length,
                matchDetails: goodMatches.map((m) => ({
                  id: m.listing.document.id,
                  score: m.qualification.score,
                  explanation: m.qualification.explanation,
                })),
              });
            }

            if (goodMatches.length === 0) {
              results.criteriaResults.push({
                criteriaId: criteria.id,
                criteriaName,
                buyerName,
                found: rawFound,
                deduped: dedupedCount,
                qualified: 0,
                saved: 0,
                usedTemporalFilter,
              });
              processedCriteriaIds.push(criteria.id);
              continue;
            }

            // Step 4: Save matches
            sendEvent({ step: 'saving', criteriaName, matchCount: goodMatches.length });

            const matchInserts = goodMatches.map((m) => ({
              criteria_id: criteria.id,
              listing_id: m.listing.document.id,
              listing_data: m.listing.document,
              relevance_score: m.qualification.score,
              qualification_notes: m.qualification.explanation,
              is_notified: false,
            }));

            const { data: savedMatches, error: saveError } = await supabase
              .from('matches')
              .upsert(matchInserts, {
                onConflict: 'criteria_id,listing_id',
                ignoreDuplicates: false,
              })
              .select();

            if (saveError) {
              results.errors.push(`Failed to save matches for ${criteriaName}: ${saveError.message}`);
              continue;
            }

            const savedCount = savedMatches?.length || 0;
            results.newMatches += savedCount;

            sendEvent({ step: 'saved', criteriaName, savedCount });

            results.criteriaResults.push({
              criteriaId: criteria.id,
              criteriaName,
              buyerName,
              found: rawFound,
              deduped: dedupedCount,
              qualified: goodMatches.length,
              saved: savedCount,
              usedTemporalFilter,
            });

            // Mark this criteria as successfully processed
            processedCriteriaIds.push(criteria.id);
          } catch (criteriaError) {
            results.errors.push(`Error processing criteria ${criteria.name}: ${criteriaError}`);
          }
        }

        // Update last_run_at for all successfully processed criteria
        if (processedCriteriaIds.length > 0) {
          const now = new Date().toISOString();
          const { error: updateError } = await supabase
            .from('buyer_criteria')
            .update({ last_run_at: now, updated_at: now })
            .in('id', processedCriteriaIds);

          if (updateError) {
            results.errors.push(`Failed to update last_run_at: ${updateError.message}`);
          }
        }

        // Complete (only if not aborted)
        if (!isAborted()) {
          results.duration = Date.now() - startTime;
          sendEvent({ step: 'complete', results });
        }
      } catch (error) {
        if (!isAborted()) {
          sendEvent({
            step: 'error',
            message: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      } finally {
        // Clean up keepalive interval
        clearInterval(keepaliveInterval);
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
