/**
 * Streaming Search Endpoint (SSE) with Debug Mode
 *
 * Runs a search with real-time progress updates via Server-Sent Events.
 * Debug mode includes raw payloads for Typesense results, Gemini prompts, and responses.
 */

import { NextRequest } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/client';
import { buildSimpleSearchBody, Criteria } from '@/lib/typesense';
import { typesenseMultiSearch } from '@/lib/typesense/client';
import { BuyerRequirements } from '@/lib/gemini/qualify';
import { BuyerCriteria, SystemPromptSetting, Buyer } from '@/lib/supabase/types';
import { TypesenseHit } from '@/lib/typesense/types';
import { buildPromptFromTemplate, DEFAULT_SYSTEM_PROMPT } from '@/lib/gemini/promptTemplate';

// Gemini API URL
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent';

interface SearchResults {
  totalSearches: number;
  totalMatches: number;
  newMatches: number;
  errors: string[];
  criteriaResults: Array<{
    criteriaId: string;
    criteriaName: string;
    found: number;
    qualified: number;
    saved: number;
  }>;
  duration: number;
}

// Convert DB criteria to Typesense criteria
function toTypesenseCriteria(dbCriteria: BuyerCriteria): Criteria {
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
    dateFrom: dbCriteria.date_from ? Math.floor(new Date(dbCriteria.date_from).getTime() / 1000) : undefined,
    dateTo: dbCriteria.date_to ? Math.floor(new Date(dbCriteria.date_to).getTime() / 1000) : undefined,
    sinceDaysAgo: 365,
    perPage: 100, // Increased from 25 to get more results
  };
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

// Build Gemini prompt for a listing using the granular template system
function buildGeminiPrompt(listing: TypesenseHit, requirements: BuyerRequirements, promptTemplate: string): string {
  // Use the new granular template system
  return buildPromptFromTemplate(promptTemplate, requirements, listing);
}

// Call Gemini API and return both request and response
async function callGeminiWithDebug(apiKey: string, prompt: string): Promise<{
  request: object;
  response: object;
  parsed: { score: number; explanation: string; highlights: string[]; concerns: string[] };
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

  // Extract JSON from response
  let jsonStr = text;
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  const parsed = JSON.parse(jsonStr);

  return {
    request: requestBody,
    response: responseData,
    parsed: {
      score: Math.max(0, Math.min(100, parsed.score)),
      explanation: parsed.explanation,
      highlights: parsed.highlights || [],
      concerns: parsed.concerns || [],
    },
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
        const { buyerId, criteriaId, debugMode = false, qualificationPrompt: customPromptFromUI } = body;

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
          errors: [],
          criteriaResults: [],
          duration: 0,
        };

        // Process each criteria
        for (const criteria of criteriaList) {
          // Check if client disconnected before processing next criteria
          if (isAborted()) {
            console.log('Client disconnected, stopping search');
            break;
          }

          try {
            results.totalSearches++;
            const criteriaName = criteria.name;

            // Step 1: Build Typesense query
            sendEvent({ step: 'searching', criteriaName });

            const searchCriteria = toTypesenseCriteria(criteria);
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
            const hits = searchResult.results[0]?.hits || [];
            const found = searchResult.results[0]?.found || 0;

            // Step 2: Found results - include raw listings in debug mode
            sendEvent({
              step: 'found',
              criteriaName,
              count: hits.length,
              total: found,
              // Debug: Include raw listings for review
              ...(debugMode && {
                listings: hits.map((hit: TypesenseHit) => ({
                  id: hit.document.id,
                  data: hit.document.data,
                  highlights: hit.highlights,
                })),
              }),
            });

            if (hits.length === 0) {
              results.criteriaResults.push({
                criteriaId: criteria.id,
                criteriaName,
                found: 0,
                qualified: 0,
                saved: 0,
              });
              continue;
            }

            // Step 3: Qualify with Gemini (in parallel batches to avoid timeouts)
            const buyerRequirements = toBuyerRequirements(criteria);

            // Determine which prompt template to use:
            // 1. UI-provided custom prompt (highest priority)
            // 2. Buyer's custom system_prompt
            // 3. Default system prompt from app_settings
            const buyer = criteria.buyer as Buyer | null;
            const activePrompt = customPromptFromUI || buyer?.system_prompt || defaultSystemPrompt;

            // Debug: Log which prompt source is being used
            if (debugMode) {
              const promptSource = customPromptFromUI
                ? 'UI (custom)'
                : buyer?.system_prompt
                  ? 'Buyer-specific'
                  : 'Default';
              sendEvent({
                step: 'debug_prompt_source',
                criteriaName,
                promptSource,
                promptLength: activePrompt.length,
              });
            }

            const qualifiedMatches: Array<{
              listing: TypesenseHit;
              qualification: { score: number; isMatch: boolean; explanation: string; highlights: string[]; concerns: string[] };
            }> = [];

            const BATCH_SIZE = 5; // Process 5 listings in parallel
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
              });

              // Process batch in parallel
              const batchPromises = batch.map(async (listing, indexInBatch) => {
                const globalIndex = batchStart + indexInBatch;
                const prompt = buildGeminiPrompt(listing, buyerRequirements, activePrompt);

                // Debug: Send the Gemini request before making the call
                if (debugMode) {
                  sendEvent({
                    step: 'debug_gemini_request',
                    criteriaName,
                    listingIndex: globalIndex + 1,
                    listingId: listing.document.id,
                    prompt: prompt,
                    listingSummary: {
                      type: listing.document.data.property_type,
                      location: listing.document.data.location_raw || listing.document.data.community,
                      price: listing.document.data.price_aed,
                      bedrooms: listing.document.data.bedrooms,
                    },
                  });
                }

                try {
                  const geminiResult = await callGeminiWithDebug(geminiKey, prompt);

                  // Debug: Send raw Gemini response
                  if (debugMode) {
                    sendEvent({
                      step: 'debug_gemini_response',
                      criteriaName,
                      listingIndex: globalIndex + 1,
                      listingId: listing.document.id,
                      rawResponse: geminiResult.response,
                      parsedResult: geminiResult.parsed,
                    });
                  }

                  const isMatch = geminiResult.parsed.score >= 60;

                  sendEvent({
                    step: 'qualified',
                    criteriaName,
                    current: globalIndex + 1,
                    total: hits.length,
                    score: geminiResult.parsed.score,
                    isMatch,
                    ...(debugMode && {
                      explanation: geminiResult.parsed.explanation,
                      highlights: geminiResult.parsed.highlights,
                      concerns: geminiResult.parsed.concerns,
                    }),
                  });

                  return {
                    listing,
                    qualification: {
                      score: geminiResult.parsed.score,
                      isMatch,
                      explanation: geminiResult.parsed.explanation,
                      highlights: geminiResult.parsed.highlights,
                      concerns: geminiResult.parsed.concerns,
                    },
                  };
                } catch (error) {
                  console.error(`Failed to qualify listing ${listing.document.id}:`, error);

                  if (debugMode) {
                    sendEvent({
                      step: 'debug_gemini_error',
                      criteriaName,
                      listingIndex: globalIndex + 1,
                      listingId: listing.document.id,
                      error: error instanceof Error ? error.message : 'Unknown error',
                    });
                  }

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
              });

              // Wait for all batch promises to complete
              const batchResults = await Promise.all(batchPromises);
              qualifiedMatches.push(...batchResults);

              // Delay between batches (not after last batch)
              if (batchIndex < totalBatches - 1) {
                await new Promise((resolve) => setTimeout(resolve, 500));
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
                found,
                qualified: 0,
                saved: 0,
              });
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
              found,
              qualified: goodMatches.length,
              saved: savedCount,
            });
          } catch (criteriaError) {
            results.errors.push(`Error processing criteria ${criteria.name}: ${criteriaError}`);
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
