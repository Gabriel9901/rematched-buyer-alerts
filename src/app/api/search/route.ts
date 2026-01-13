/**
 * Manual Search Endpoint
 *
 * Runs a search for a specific criteria or all active criteria for a buyer.
 * Similar to the cron job but can be triggered on demand.
 *
 * Supports temporal deduplication: uses last_run_at to only search for new listings.
 * Pass `fullRescan: true` in the request body to ignore last_run_at and do a full search.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/client';
import { buildSimpleSearchBody, Criteria } from '@/lib/typesense';
import { typesenseMultiSearch } from '@/lib/typesense/client';
import { qualifyMatches, BuyerRequirements } from '@/lib/gemini/qualify';
import { BuyerCriteria } from '@/lib/supabase/types';
import { TypesenseHit } from '@/lib/typesense/types';

// Default days to look back if no last_run_at is set
const DEFAULT_LOOKBACK_DAYS = 7; // Larger window for manual searches

// Convert DB criteria to Typesense criteria with temporal filtering
function toTypesenseCriteria(dbCriteria: BuyerCriteria, useTemporalFilter: boolean = true): Criteria {
  // Determine the date filter based on last_run_at (temporal deduplication)
  let dateFrom: number | undefined = undefined;

  if (useTemporalFilter && dbCriteria.last_run_at) {
    // Use last_run_at for temporal filtering - only get listings since last run
    dateFrom = Math.floor(new Date(dbCriteria.last_run_at).getTime() / 1000);
  } else if (dbCriteria.date_from) {
    // Use explicit date_from from criteria if set
    dateFrom = Math.floor(new Date(dbCriteria.date_from).getTime() / 1000);
  }
  // If neither is set, sinceDaysAgo will be used as fallback

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

    // New filter fields
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

    // Temporal filtering: use dateFrom from last_run_at if available
    dateFrom: dateFrom,
    dateTo: dbCriteria.date_to ? Math.floor(new Date(dbCriteria.date_to).getTime() / 1000) : undefined,

    // Fallback: if no dateFrom is set, use sinceDaysAgo
    sinceDaysAgo: dateFrom ? undefined : DEFAULT_LOOKBACK_DAYS,
    perPage: 25, // Balance between coverage and Gemini qualification time
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
    keywords: dbCriteria.keywords || undefined,
    // Pass AI prompt for custom qualification questions
    additionalNotes: dbCriteria.ai_prompt || undefined,
  };
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body = await request.json();
    const {
      buyerId,
      criteriaId,
      fullRescan = false, // If true, ignore last_run_at and do full search
    } = body;

    if (!buyerId && !criteriaId) {
      return NextResponse.json(
        { error: 'Either buyerId or criteriaId is required' },
        { status: 400 }
      );
    }

    const supabase = getServerSupabase();
    const typesenseKey = process.env.TYPESENSE_SCOPED_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    if (!typesenseKey || !geminiKey) {
      return NextResponse.json(
        { error: 'Missing API keys' },
        { status: 500 }
      );
    }

    // Fetch criteria to search
    let query = supabase
      .from('buyer_criteria')
      .select(`
        *,
        buyer:buyers(*)
      `)
      .eq('is_active', true);

    if (criteriaId) {
      query = query.eq('id', criteriaId);
    } else if (buyerId) {
      query = query.eq('buyer_id', buyerId);
    }

    const { data: criteriaList, error: criteriaError } = await query;

    if (criteriaError) {
      throw new Error(`Failed to fetch criteria: ${criteriaError.message}`);
    }

    if (!criteriaList || criteriaList.length === 0) {
      return NextResponse.json({
        message: 'No active criteria found',
        results: { totalSearches: 0, totalMatches: 0 },
        duration: Date.now() - startTime,
      });
    }

    const results = {
      totalSearches: 0,
      totalMatches: 0,
      newMatches: 0,
      totalListingsFound: 0,
      totalListingsDeduped: 0,
      fullRescan, // Include in response so caller knows which mode was used
      errors: [] as string[],
      criteriaResults: [] as Array<{
        criteriaId: string;
        criteriaName: string;
        buyerName: string;
        found: number;
        deduped: number;
        qualified: number;
        saved: number;
        usedTemporalFilter: boolean;
      }>,
    };

    // Track seen listing IDs across all criteria for in-memory deduplication
    const seenListingIds = new Set<string>();

    // Track criteria IDs that were successfully processed (for updating last_run_at)
    const processedCriteriaIds: string[] = [];

    // Process each criteria
    for (const criteria of criteriaList) {
      const buyerName = (criteria.buyer as { name: string })?.name || 'Unknown';
      // Use temporal filter unless fullRescan is requested
      const useTemporalFilter = !fullRescan;
      const usedTemporalFilter = useTemporalFilter && !!criteria.last_run_at;

      try {
        results.totalSearches++;

        // Build and execute Typesense search (uses last_run_at for temporal filtering unless fullRescan)
        const searchCriteria = toTypesenseCriteria(criteria, useTemporalFilter);
        const searchBody = buildSimpleSearchBody(searchCriteria);
        const searchResult = await typesenseMultiSearch(typesenseKey, searchBody);

        const rawHits = searchResult.results[0]?.hits || [];
        const rawFound = rawHits.length;
        results.totalListingsFound += rawFound;

        if (rawHits.length === 0) {
          results.criteriaResults.push({
            criteriaId: criteria.id,
            criteriaName: criteria.name,
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

        // Deduplicate listings that were already seen in this run
        const hits = deduplicateListings(rawHits, seenListingIds);
        const dedupedCount = rawFound - hits.length;
        results.totalListingsDeduped += dedupedCount;

        if (hits.length === 0) {
          results.criteriaResults.push({
            criteriaId: criteria.id,
            criteriaName: criteria.name,
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

        // Qualify matches with Gemini
        const buyerRequirements = toBuyerRequirements(criteria);
        const qualifiedMatches = await qualifyMatches(
          geminiKey,
          hits,
          buyerRequirements,
          {
            threshold: 60,
            concurrency: 3,
          }
        );

        // Filter to only good matches
        const goodMatches = qualifiedMatches.filter((m) => m.qualification.isMatch);
        results.totalMatches += goodMatches.length;

        if (goodMatches.length === 0) {
          results.criteriaResults.push({
            criteriaId: criteria.id,
            criteriaName: criteria.name,
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

        // Save matches to Supabase
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
            ignoreDuplicates: false, // Update existing matches
          })
          .select();

        if (saveError) {
          results.errors.push(`Failed to save matches for ${criteria.name}: ${saveError.message}`);
          continue;
        }

        const savedCount = savedMatches?.length || 0;
        results.newMatches += savedCount;

        results.criteriaResults.push({
          criteriaId: criteria.id,
          criteriaName: criteria.name,
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
        results.errors.push(
          `Error processing criteria ${criteria.name}: ${criteriaError}`
        );
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

    return NextResponse.json({
      message: 'Search completed',
      results,
      duration: Date.now() - startTime,
    });
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json(
      {
        error: 'Search failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}
