/**
 * Database Operations
 *
 * CRUD operations for buyers, criteria, and matches.
 */

import { supabase, getServerSupabase } from './client';
import {
  Buyer,
  BuyerCriteria,
  Match,
  BuyerInsert,
  BuyerCriteriaInsert,
  MatchInsert,
  BuyerUpdate,
  BuyerCriteriaUpdate,
  BuyerWithCriteria,
  MatchWithDetails,
} from './types';

// =============================================================================
// BUYERS
// =============================================================================

export async function getBuyers(): Promise<Buyer[]> {
  const { data, error } = await supabase
    .from('buyers')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function getBuyerById(id: string): Promise<BuyerWithCriteria | null> {
  const { data, error } = await supabase
    .from('buyers')
    .select(`
      *,
      criteria:buyer_criteria(*)
    `)
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // Not found
    throw error;
  }
  return data;
}

export async function createBuyer(buyer: BuyerInsert): Promise<Buyer> {
  const { data, error } = await supabase
    .from('buyers')
    .insert(buyer)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateBuyer(id: string, updates: BuyerUpdate): Promise<Buyer> {
  const { data, error } = await supabase
    .from('buyers')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteBuyer(id: string): Promise<void> {
  const { error } = await supabase.from('buyers').delete().eq('id', id);
  if (error) throw error;
}

// =============================================================================
// BUYER CRITERIA
// =============================================================================

export async function getCriteriaByBuyerId(buyerId: string): Promise<BuyerCriteria[]> {
  const { data, error } = await supabase
    .from('buyer_criteria')
    .select('*')
    .eq('buyer_id', buyerId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function getActiveCriteria(): Promise<BuyerCriteria[]> {
  const { data, error } = await supabase
    .from('buyer_criteria')
    .select('*')
    .eq('is_active', true);

  if (error) throw error;
  return data || [];
}

export async function getCriteriaById(id: string): Promise<BuyerCriteria | null> {
  const { data, error } = await supabase
    .from('buyer_criteria')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data;
}

export async function createCriteria(criteria: BuyerCriteriaInsert): Promise<BuyerCriteria> {
  const { data, error } = await supabase
    .from('buyer_criteria')
    .insert(criteria)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateCriteria(
  id: string,
  updates: BuyerCriteriaUpdate
): Promise<BuyerCriteria> {
  const { data, error } = await supabase
    .from('buyer_criteria')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteCriteria(id: string): Promise<void> {
  const { error } = await supabase.from('buyer_criteria').delete().eq('id', id);
  if (error) throw error;
}

// =============================================================================
// MATCHES
// =============================================================================

export async function getMatchesByCriteriaId(criteriaId: string): Promise<Match[]> {
  const { data, error } = await supabase
    .from('matches')
    .select('*')
    .eq('criteria_id', criteriaId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function getRecentMatches(limit: number = 50): Promise<MatchWithDetails[]> {
  const { data, error } = await supabase
    .from('matches')
    .select(`
      *,
      criteria:buyer_criteria(
        *,
        buyer:buyers(*)
      )
    `)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

export async function getUnnotifiedMatches(): Promise<MatchWithDetails[]> {
  const { data, error } = await supabase
    .from('matches')
    .select(`
      *,
      criteria:buyer_criteria(
        *,
        buyer:buyers(*)
      )
    `)
    .eq('is_notified', false)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function createMatch(match: MatchInsert): Promise<Match> {
  const { data, error } = await supabase
    .from('matches')
    .insert(match)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function createMatchesBatch(matches: MatchInsert[]): Promise<Match[]> {
  if (matches.length === 0) return [];

  const { data, error } = await supabase
    .from('matches')
    .upsert(matches, {
      onConflict: 'criteria_id,listing_id',
      ignoreDuplicates: true,
    })
    .select();

  if (error) throw error;
  return data || [];
}

export async function markMatchNotified(id: string): Promise<void> {
  const { error } = await supabase
    .from('matches')
    .update({
      is_notified: true,
      notified_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) throw error;
}

export async function markMatchesNotified(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  const { error } = await supabase
    .from('matches')
    .update({
      is_notified: true,
      notified_at: new Date().toISOString(),
    })
    .in('id', ids);

  if (error) throw error;
}

// =============================================================================
// CRITERIA RUN TRACKING
// =============================================================================

/**
 * Update the last_run_at timestamp for a criteria after a successful search.
 * This is used for temporal deduplication - subsequent runs will only search
 * for listings newer than this timestamp.
 */
export async function updateCriteriaLastRunAt(criteriaId: string): Promise<void> {
  const { error } = await supabase
    .from('buyer_criteria')
    .update({
      last_run_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', criteriaId);

  if (error) throw error;
}

/**
 * Update last_run_at for multiple criteria in a batch.
 */
export async function updateCriteriaLastRunAtBatch(criteriaIds: string[]): Promise<void> {
  if (criteriaIds.length === 0) return;

  const { error } = await supabase
    .from('buyer_criteria')
    .update({
      last_run_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .in('id', criteriaIds);

  if (error) throw error;
}
