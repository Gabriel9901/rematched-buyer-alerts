/**
 * Daily Cron Job Endpoint
 *
 * This endpoint runs the daily search for all active buyer criteria.
 * It should be called by a cron scheduler (Cloud Scheduler, Vercel Cron, etc.)
 *
 * Flow:
 * 1. Fetch all active criteria from Supabase
 * 2. For each criteria, search Typesense for listings from the last 24 hours
 * 3. Qualify matches using Gemini AI
 * 4. Save matches to Supabase
 * 5. Send Slack notifications for new matches
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/client';
import { buildSimpleSearchBody, Criteria } from '@/lib/typesense';
import { typesenseMultiSearch } from '@/lib/typesense/client';
import { qualifyMatches, BuyerRequirements } from '@/lib/gemini/qualify';
import { sendSlackNotification, sendDailySummary } from '@/lib/slack/notify';
import { BuyerCriteria } from '@/lib/supabase/types';

// Verify cron secret to prevent unauthorized access
function verifyCronSecret(request: NextRequest): boolean {
  const secret = request.headers.get('x-cron-secret') ||
    request.nextUrl.searchParams.get('secret');
  return secret === process.env.CRON_SECRET;
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

    // New filter fields (optional - may not exist in DB yet)
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

    sinceDaysAgo: 365, // Extended for testing - change back to 1 for production
    perPage: 50, // Results per criteria to qualify
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
  };
}

export async function GET(request: NextRequest) {
  // Verify authorization
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startTime = Date.now();
  const results = {
    totalSearches: 0,
    totalMatches: 0,
    errors: [] as string[],
    buyerStats: [] as { name: string; matchCount: number }[],
  };

  try {
    const supabase = getServerSupabase();

    // 1. Fetch all active criteria with buyer info
    const { data: criteriaList, error: criteriaError } = await supabase
      .from('buyer_criteria')
      .select(`
        *,
        buyer:buyers(*)
      `)
      .eq('is_active', true);

    if (criteriaError) {
      throw new Error(`Failed to fetch criteria: ${criteriaError.message}`);
    }

    if (!criteriaList || criteriaList.length === 0) {
      return NextResponse.json({
        message: 'No active criteria found',
        results,
        duration: Date.now() - startTime,
      });
    }

    const typesenseKey = process.env.TYPESENSE_SCOPED_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;
    const slackWebhook = process.env.SLACK_WEBHOOK_URL;

    if (!typesenseKey || !geminiKey) {
      throw new Error('Missing required API keys (TYPESENSE_SCOPED_KEY or GEMINI_API_KEY)');
    }

    // 2. Process each criteria
    for (const criteria of criteriaList) {
      try {
        results.totalSearches++;

        // Build and execute Typesense search
        const searchCriteria = toTypesenseCriteria(criteria);
        const searchBody = buildSimpleSearchBody(searchCriteria);
        const searchResult = await typesenseMultiSearch(typesenseKey, searchBody);

        const hits = searchResult.results[0]?.hits || [];
        if (hits.length === 0) continue;

        // 3. Qualify matches with Gemini
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

        if (goodMatches.length === 0) continue;

        // 4. Save matches to Supabase
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
            ignoreDuplicates: true,
          })
          .select();

        if (saveError) {
          results.errors.push(`Failed to save matches for ${criteria.name}: ${saveError.message}`);
          continue;
        }

        const newMatchCount = savedMatches?.length || 0;
        results.totalMatches += newMatchCount;

        // Track buyer stats
        const buyerName = (criteria.buyer as { name: string })?.name || 'Unknown';
        const existingStat = results.buyerStats.find((s) => s.name === buyerName);
        if (existingStat) {
          existingStat.matchCount += newMatchCount;
        } else {
          results.buyerStats.push({ name: buyerName, matchCount: newMatchCount });
        }

        // 5. Send Slack notification for new matches
        if (slackWebhook && newMatchCount > 0 && savedMatches) {
          try {
            // Fetch full match details for notification
            const { data: matchDetails } = await supabase
              .from('matches')
              .select(`
                *,
                criteria:buyer_criteria(
                  *,
                  buyer:buyers(*)
                )
              `)
              .in('id', savedMatches.map((m) => m.id));

            if (matchDetails && matchDetails.length > 0) {
              await sendSlackNotification(
                slackWebhook,
                buyerName,
                criteria.name,
                matchDetails
              );

              // Mark as notified
              await supabase
                .from('matches')
                .update({ is_notified: true, notified_at: new Date().toISOString() })
                .in('id', savedMatches.map((m) => m.id));
            }
          } catch (notifyError) {
            results.errors.push(`Slack notification failed: ${notifyError}`);
          }
        }
      } catch (criteriaError) {
        results.errors.push(
          `Error processing criteria ${criteria.name}: ${criteriaError}`
        );
      }
    }

    // 6. Send daily summary
    if (slackWebhook) {
      try {
        await sendDailySummary(slackWebhook, {
          totalSearches: results.totalSearches,
          totalMatches: results.totalMatches,
          topBuyers: results.buyerStats.sort((a, b) => b.matchCount - a.matchCount).slice(0, 5),
        });
      } catch (summaryError) {
        results.errors.push(`Daily summary failed: ${summaryError}`);
      }
    }

    return NextResponse.json({
      message: 'Cron job completed',
      results,
      duration: Date.now() - startTime,
    });
  } catch (error) {
    console.error('Cron job error:', error);
    return NextResponse.json(
      {
        error: 'Cron job failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        results,
        duration: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}

// Also support POST for manual triggers
export async function POST(request: NextRequest) {
  return GET(request);
}
