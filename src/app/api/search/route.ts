/**
 * Manual Search Endpoint
 *
 * Runs a search for a specific criteria or all active criteria for a buyer.
 * Similar to the cron job but can be triggered on demand.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/client';
import { buildSimpleSearchBody, Criteria } from '@/lib/typesense';
import { typesenseMultiSearch } from '@/lib/typesense/client';
import { qualifyMatches, BuyerRequirements } from '@/lib/gemini/qualify';
import { BuyerCriteria } from '@/lib/supabase/types';

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
    dateFrom: dbCriteria.date_from ? Math.floor(new Date(dbCriteria.date_from).getTime() / 1000) : undefined,
    dateTo: dbCriteria.date_to ? Math.floor(new Date(dbCriteria.date_to).getTime() / 1000) : undefined,

    // For manual search, don't limit by time
    sinceDaysAgo: 365,
    perPage: 25, // Balance between coverage and Gemini qualification time
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
    keywords: dbCriteria.keywords || undefined,
    // Pass AI prompt for custom qualification questions
    additionalNotes: dbCriteria.ai_prompt || undefined,
  };
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body = await request.json();
    const { buyerId, criteriaId } = body;

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
      errors: [] as string[],
      criteriaResults: [] as Array<{
        criteriaId: string;
        criteriaName: string;
        found: number;
        qualified: number;
        saved: number;
      }>,
    };

    // Process each criteria
    for (const criteria of criteriaList) {
      try {
        results.totalSearches++;

        // Build and execute Typesense search
        const searchCriteria = toTypesenseCriteria(criteria);
        const searchBody = buildSimpleSearchBody(searchCriteria);
        const searchResult = await typesenseMultiSearch(typesenseKey, searchBody);

        const hits = searchResult.results[0]?.hits || [];
        const found = searchResult.results[0]?.found || 0;

        if (hits.length === 0) {
          results.criteriaResults.push({
            criteriaId: criteria.id,
            criteriaName: criteria.name,
            found: 0,
            qualified: 0,
            saved: 0,
          });
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
            found,
            qualified: 0,
            saved: 0,
          });
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
          found,
          qualified: goodMatches.length,
          saved: savedCount,
        });

      } catch (criteriaError) {
        results.errors.push(
          `Error processing criteria ${criteria.name}: ${criteriaError}`
        );
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
